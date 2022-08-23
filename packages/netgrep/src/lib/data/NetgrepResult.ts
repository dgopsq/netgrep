/**
 *
 */
export type NetgrepResult = {
  url: string;

  result: {
    count: number;
    lines: Array<string>;
  };
};
