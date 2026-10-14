/** BullMQ queues (docs/09, 9.8). */
export const QUEUES = {
  outbox: 'outbox',
  payroll: 'payroll',
  notifications: 'notifications',
  scheduled: 'scheduled',
} as const;

export const JOBS = {
  outboxPublish: 'outbox.publish',
  payrollCalculate: 'payroll.calculate',
  notificationDeliver: 'notifications.deliver',
  alertsDaily: 'alerts.daily',
} as const;

/** Runs that size are calculated in the worker instead of inside the HTTP request. */
export const SYNC_PAYROLL_LIMIT = 50;

export function redisConnection(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    password: parsed.password || undefined,
    maxRetriesPerRequest: null,
  };
}
