/**
 * @fileoverview Implements the authentication/session boundary that connects Cognito OAuth, tenant identity resolution, opaque server-side sessions and protected Fastify requests.
 *
 * @remarks
 * Direct links: `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-dynamodb`, `@edutex/contracts`, `../../config.js`.
 * Security: Authentication/session security boundary; changes require negative tests for replay, binding, MFA and unauthenticated access.
 */

import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { SessionUser } from '@edutex/contracts';

import type { ApplicationConfiguration } from '../../config.js';

export interface StoredSession {
  readonly sessionHash: string;
  readonly deviceHash: string;
  readonly userAgentHash: string;
  readonly csrfToken: string;
  readonly user: SessionUser;
  readonly identityVersion: number;
  readonly createdAtEpoch: number;
  readonly lastSeenAtEpoch: number;
  readonly identityCheckedAtEpoch: number;
  readonly idleExpiresAtEpoch: number;
  readonly absoluteExpiresAtEpoch: number;
  readonly expiresAtEpoch: number;
}

export interface AuthTransaction {
  readonly stateHash: string;
  readonly tenantId: string;
  readonly codeVerifier: string;
  readonly bindingHash: string;
  readonly nonce: string;
  readonly providerKey: string;
  readonly returnTo: string;
  readonly stepUp: boolean;
  readonly expiresAtEpoch: number;
}

export interface SessionStore {
  create(session: StoredSession): Promise<void>;
  delete(sessionHash: string): Promise<void>;
  get(sessionHash: string): Promise<StoredSession | undefined>;
  replace(session: StoredSession): Promise<void>;
  touch(
    sessionHash: string,
    idleExpiresAtEpoch: number,
    expiresAtEpoch: number,
    nowEpoch: number,
  ): Promise<void>;
}

export interface TransactionStore {
  consume(stateHash: string): Promise<AuthTransaction | undefined>;
  create(transaction: AuthTransaction): Promise<void>;
}

class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, StoredSession>();

  /** Stores a cloned session for local tests so callers cannot mutate persisted state by reference. */
  public create(session: StoredSession): Promise<void> {
    this.sessions.set(session.sessionHash, structuredClone(session));
    return Promise.resolve();
  }

  /** Removes one local device session by its token hash; missing sessions are treated as revoked. */
  public delete(sessionHash: string): Promise<void> {
    this.sessions.delete(sessionHash);
    return Promise.resolve();
  }

  /** Returns a defensive clone of one local session, or undefined when it is absent. */
  public get(sessionHash: string): Promise<StoredSession | undefined> {
    const value = this.sessions.get(sessionHash);
    return Promise.resolve(value ? structuredClone(value) : undefined);
  }

  /** Atomically replaces the local representation of an existing session. */
  public replace(session: StoredSession): Promise<void> {
    this.sessions.set(session.sessionHash, structuredClone(session));
    return Promise.resolve();
  }

  /** Advances bounded idle/last-seen timestamps for an existing local session. */
  public touch(
    sessionHash: string,
    idleExpiresAtEpoch: number,
    expiresAtEpoch: number,
    nowEpoch: number,
  ): Promise<void> {
    const current = this.sessions.get(sessionHash);
    if (!current) return Promise.resolve();
    this.sessions.set(sessionHash, {
      ...current,
      idleExpiresAtEpoch,
      expiresAtEpoch,
      lastSeenAtEpoch: nowEpoch,
    });
    return Promise.resolve();
  }
}

class MemoryTransactionStore implements TransactionStore {
  private readonly transactions = new Map<string, AuthTransaction>();

  /** Reads and deletes a local OAuth transaction to preserve one-time state semantics. */
  public consume(stateHash: string): Promise<AuthTransaction | undefined> {
    const value = this.transactions.get(stateHash);
    this.transactions.delete(stateHash);
    return Promise.resolve(value ? structuredClone(value) : undefined);
  }

  /** Stores a cloned, short-lived local OAuth transaction for test/development use. */
  public create(transaction: AuthTransaction): Promise<void> {
    this.transactions.set(transaction.stateHash, structuredClone(transaction));
    return Promise.resolve();
  }
}

class DynamoSessionStore implements SessionStore {
  /** Constructs `session-store` and assembles the AWS/resource relationships defined in this class without exposing a public origin or broader credentials. It receives `documentClient`, `tableName`. It uses only the local values shown in its body. */ public constructor(
    private readonly documentClient: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  /** Conditionally inserts a production session and refuses token-hash collisions. */
  public async create(session: StoredSession): Promise<void> {
    await this.documentClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: session,
        ConditionExpression: 'attribute_not_exists(sessionHash)',
      }),
    );
  }

  /** Revokes one production device session with an idempotent DynamoDB delete. */
  public async delete(sessionHash: string): Promise<void> {
    await this.documentClient.send(
      new DeleteCommand({ TableName: this.tableName, Key: { sessionHash } }),
    );
  }

  /** Consistently reads a production session so revocation is observed immediately. */
  public async get(sessionHash: string): Promise<StoredSession | undefined> {
    const result = await this.documentClient.send(
      new GetCommand({ TableName: this.tableName, Key: { sessionHash }, ConsistentRead: true }),
    );
    return result.Item as StoredSession | undefined;
  }

  /** Replaces an existing production session only when the token hash still exists. */
  public async replace(session: StoredSession): Promise<void> {
    await this.documentClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: session,
        ConditionExpression: 'attribute_exists(sessionHash)',
      }),
    );
  }

  /** Updates only activity/expiry fields for an existing production session. */
  public async touch(
    sessionHash: string,
    idleExpiresAtEpoch: number,
    expiresAtEpoch: number,
    nowEpoch: number,
  ): Promise<void> {
    await this.documentClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { sessionHash },
        UpdateExpression:
          'set lastSeenAtEpoch = :now, idleExpiresAtEpoch = :idle, expiresAtEpoch = :expiry',
        ExpressionAttributeValues: {
          ':now': nowEpoch,
          ':idle': idleExpiresAtEpoch,
          ':expiry': expiresAtEpoch,
        },
        ConditionExpression: 'attribute_exists(sessionHash)',
      }),
    );
  }
}

class DynamoTransactionStore implements TransactionStore {
  /** Constructs `session-store` and assembles the AWS/resource relationships defined in this class without exposing a public origin or broader credentials. It receives `documentClient`, `tableName`. It uses only the local values shown in its body. */ public constructor(
    private readonly documentClient: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  /** Atomically deletes and returns a production OAuth transaction, preventing replay. */
  public async consume(stateHash: string): Promise<AuthTransaction | undefined> {
    const result = await this.documentClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { stateHash },
        ReturnValues: 'ALL_OLD',
      }),
    );
    return result.Attributes as AuthTransaction | undefined;
  }

  /** Conditionally creates a production OAuth transaction and rejects duplicate state hashes. */
  public async create(transaction: AuthTransaction): Promise<void> {
    await this.documentClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: transaction,
        ConditionExpression: 'attribute_not_exists(stateHash)',
      }),
    );
  }
}

/** Builds either local in-memory adapters or KMS-encrypted DynamoDB-backed stores. */
export function createStores(configuration: ApplicationConfiguration): {
  readonly sessionStore: SessionStore;
  readonly transactionStore: TransactionStore;
} {
  if (configuration.sessionStore === 'memory') {
    return {
      sessionStore: new MemorySessionStore(),
      transactionStore: new MemoryTransactionStore(),
    };
  }
  const documentClient = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: configuration.awsRegion }),
    { marshallOptions: { removeUndefinedValues: true } },
  );
  return {
    sessionStore: new DynamoSessionStore(documentClient, configuration.sessionTableName),
    transactionStore: new DynamoTransactionStore(
      documentClient,
      configuration.authTransactionTableName,
    ),
  };
}
