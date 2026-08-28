export const EventTypes = {
  SETTINGS_CHANGED: 'SETTINGS_CHANGED',
  USER_ONBOARDED: 'USER_ONBOARDED',
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];
