-- Source standards intentionally carry local section numbers. The compiled manual adds
-- chapter-aware numbering, so remove only a leading local "N. " marker to prevent labels
-- such as "3.1 1. Repository" while preserving the source Markdown unchanged.
function Header(element)
  local text = pandoc.utils.stringify(element.content)
  local normalised = text:gsub('^%d+%.%s+', '')

  if normalised ~= text then
    element.content = { pandoc.Str(normalised) }
  end

  return element
end

-- Pandoc derives pipe-table widths from the Markdown delimiter row. Very short identifier/status
-- columns can therefore become narrower than a single readable token. Enforce a modest minimum and
-- redistribute the remainder according to the author's original proportions.
function Table(element)
  local count = #element.colspecs
  local minimum = 0.08

  -- The five-column ISO control catalogue and seven-column risk register contain long controlled
  -- status/owner labels. Fixed review-tested proportions prevent those indivisible labels from
  -- overrunning adjacent evidence columns on A4 pages.
  local fixed = nil
  if count == 5 then
    fixed = { 0.09, 0.19, 0.09, 0.215, 0.415 }
  elseif count == 7 then
    fixed = { 0.06, 0.21, 0.07, 0.32, 0.07, 0.145, 0.125 }
  end

  if fixed ~= nil then
    for index, column in ipairs(element.colspecs) do
      column[2] = fixed[index]
      element.colspecs[index] = column
    end
    return element
  end

  if count == 2 then
    minimum = 0.18
  elseif count == 3 then
    minimum = 0.15
  elseif count == 4 then
    minimum = 0.12
  elseif count == 5 then
    minimum = 0.09
  elseif count >= 7 then
    minimum = 0.075
  end

  local original = {}
  local flexible_total = 0
  local all_default = true

  for index, column in ipairs(element.colspecs) do
    local width = column[2]
    if width == nil or width <= 0 then
      width = 1 / count
    else
      all_default = false
    end
    original[index] = width
    flexible_total = flexible_total + math.max(width - minimum, 0)
  end

  if all_default or flexible_total == 0 or minimum * count >= 1 then
    for index, column in ipairs(element.colspecs) do
      column[2] = 1 / count
      element.colspecs[index] = column
    end
    return element
  end

  local distributable = 1 - (minimum * count)
  for index, column in ipairs(element.colspecs) do
    local extra = math.max(original[index] - minimum, 0)
    column[2] = minimum + (distributable * extra / flexible_total)
    element.colspecs[index] = column
  end

  return element
end
