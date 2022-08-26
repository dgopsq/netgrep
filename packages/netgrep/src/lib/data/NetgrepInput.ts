/**
 *
 */
export type NetgrepInput<T extends object = object> = {
  url: string;
  metadata?: T;
};
