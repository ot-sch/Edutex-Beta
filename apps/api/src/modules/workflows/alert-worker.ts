/** @fileoverview Durable multi-instance alert worker refreshes owner access and records real provider outcomes. */
import { randomUUID } from 'node:crypto';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { alertRuleSchema } from '@edutex/contracts';
import { runInSystemTransaction } from '@edutex/database';
import type { FastifyInstance } from 'fastify';
import { refreshIdentity } from '../auth/identity-repository.js';
import { evaluateAlert } from './alerts.js';
import { datasets } from './insights.js';
/** Runs one bounded polling cycle; SQL claims allow multiple Fargate tasks to share the queue safely. */
export async function processAlertCycle(server: FastifyInstance): Promise<void> {
  const claimed = await runInSystemTransaction(
    /** Runs the bounded alert worker operation under the explicitly supplied service audit identity. */
    async (client) =>
      client.query<{ id: string; tenant_id: string; owner_user_id: string; definition: unknown }>(
        'select * from app.claim_due_alerts()',
      ),
  );
  for (const record of claimed.rows) {
    try {
      const owner = await refreshIdentity(record.tenant_id, record.owner_user_id);
      const rule = alertRuleSchema.parse(record.definition);
      const source = requiredValue(datasets[rule.source]);
      if (
        !owner ||
        !owner.enabledModules.includes('smart-alerts') ||
        !owner.enabledModules.includes(source.module as never) ||
        !owner.permissions.some(
          /** Selects owner.permissions entries using the explicit smart alerts edit smart alerts manage platform manage .includes p condition. */
          (p) => ['smart-alerts:edit', 'smart-alerts:manage', 'platform:manage'].includes(p),
        )
      )
        throw new Error('OWNER_ACCESS_REVOKED');
      await evaluateAlert(
        {
          tenantId: record.tenant_id,
          userId: owner.id,
          permissions: owner.permissions,
          requestId: 'alert-' + randomUUID(),
        },
        record.id,
        rule,
        false,
      );
    } catch {
      await runInSystemTransaction(
        /** Runs the bounded alert worker operation under the explicitly supplied service audit identity. */
        async (client) =>
          client.query<Record<string, unknown>>('select app.record_alert_error($1,$2)', [
            record.id,
            'EVALUATION_FAILED_OR_ACCESS_REVOKED',
          ]),
      );
      server.log.warn(
        { ruleId: record.id },
        'Alert evaluation failed; inspect source permissions and rule definition.',
      );
    }
  }
  const email = new SESv2Client({ region: server.configuration.awsRegion, maxAttempts: 1 });
  const sms = new SNSClient({ region: server.configuration.awsRegion, maxAttempts: 1 });
  try {
    for (let index = 0; index < 20; index++) {
      const result = await runInSystemTransaction(
        /** Runs the bounded alert worker operation under the explicitly supplied service audit identity. */
        async (client) =>
          client.query<{ id: string; tenant_id: string; channel: string; address: string | null }>(
            'select * from app.claim_alert_delivery()',
          ),
      );
      const delivery = result.rows[0];
      if (!delivery) break;
      let outcome = 'blocked';
      let reference: string | null = null;
      let error: string | null = 'CHANNEL_NOT_CONFIGURED';
      try {
        const message =
          'A school workflow needs your attention. Sign in to your school Edutex portal to view information permitted for your account.';
        if (delivery.channel === 'email' && server.configuration.alertEmailFrom) {
          if (!delivery.address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(delivery.address)) {
            error = 'RECIPIENT_ADDRESS_MISSING';
          } else {
            const sent = await email.send(
              new SendEmailCommand({
                FromEmailAddress: server.configuration.alertEmailFrom,
                Destination: { ToAddresses: [delivery.address] },
                Content: {
                  Simple: {
                    Subject: { Data: 'School follow-up required', Charset: 'UTF-8' },
                    Body: { Text: { Data: message, Charset: 'UTF-8' } },
                  },
                },
              }),
              { abortSignal: AbortSignal.timeout(15000) },
            );
            reference = sent.MessageId ?? null;
            outcome = reference ? 'sent' : 'blocked';
            error = reference ? null : 'PROVIDER_RECEIPT_MISSING';
          }
        }
        if (delivery.channel === 'sms' && server.configuration.alertSmsEnabled) {
          if (!delivery.address || !/^\+[1-9]\d{7,14}$/.test(delivery.address)) {
            error = 'PHONE_REQUIRES_E164';
          } else {
            const sent = await sms.send(
              new PublishCommand({
                PhoneNumber: delivery.address,
                Message: message,
                MessageAttributes: {
                  'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
                },
              }),
              { abortSignal: AbortSignal.timeout(15000) },
            );
            reference = sent.MessageId ?? null;
            outcome = reference ? 'sent' : 'blocked';
            error = reference ? null : 'PROVIDER_RECEIPT_MISSING';
          }
        }
      } catch {
        outcome = 'blocked';
        error = 'DELIVERY_OUTCOME_REQUIRES_REVIEW';
      }
      await runInSystemTransaction(
        /** Runs the bounded alert worker operation under the explicitly supplied service audit identity. */
        async (client) =>
          client.query<Record<string, unknown>>('select app.finish_alert_delivery($1,$2,$3,$4)', [
            delivery.id,
            outcome,
            reference,
            error,
          ]),
      );
    }
  } finally {
    email.destroy();
    sms.destroy();
  }
}
/** Starts polling only in the running API service; tests and application construction never send messages. */
export function startAlertWorker(server: FastifyInstance): void {
  let running = false;
  let stopped = false; /** Coordinates poll within alert worker, preserving the caller's validation and error handling. */
  const poll = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      await processAlertCycle(server);
    } catch {
      server.log.error('Alert worker cycle failed; database connectivity requires review.');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(
    /** Schedules the bounded alert worker poll; overlapping work is guarded by the caller. */
    () => void poll(),
    60000,
  );
  timer.unref();
  server.addHook(
    'onClose',

    /** Coordinates clear Interval within alert worker, preserving the caller's validation and error handling. */
    () => {
      stopped = true;
      clearInterval(timer);
      return Promise.resolve();
    },
  );
}

import { requiredValue } from '@edutex/contracts';
