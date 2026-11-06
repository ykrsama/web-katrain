export type FoxGame = { chessid: string; black: string; white: string; date: string; moves: number | string };
export type FoxUser = { uid: string; nickname: string; mode: 'nickname' | 'uid' };
export type FoxPage = {
  games: FoxGame[];
  count: number;
  next_cursor: string | null;
  can_request_next: boolean;
  user?: FoxUser;
  uid: string;
};
export type FoxRecord = {
  chessid: string;
  sgf: string;
  bytes: number;
  secure_transport: boolean;
  info: { black: string; white: string; komi: string };
};
