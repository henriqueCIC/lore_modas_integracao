const DAY = 86_400_000;

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validRentalDates(pickup, due) {
  return validDate(pickup) && validDate(due) && pickup <= due;
}

export function daysLate(due, returned) {
  if (!validDate(due) || !validDate(returned)) throw new Error('Data inválida');
  return Math.max(0, Math.round((Date.parse(`${returned}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / DAY));
}

export function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}
