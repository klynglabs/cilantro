import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { EventEmitter } from "node:events";

import type { TokenService } from "@/services/token.service";

class FakeSteam extends EventEmitter {
  static EResult = {
    Invalid: 0,
    Fail: 2,
    NoConnection: 3,
    InvalidPassword: 5,
    LoggedInElsewhere: 6,
    Busy: 10,
    AccessDenied: 15,
    Timeout: 16,
    ServiceUnavailable: 20,
    Revoked: 26,
    Expired: 27,
    LogonSessionReplaced: 34,
    TryAnotherCM: 48,
    RateLimitExceeded: 84,
  };
  static EPersonaState = { Online: 1 };
  static outcomes: (number | "ok")[] = [];

  steamID: object | null = null;
  logOnCalls = 0;

  logOn() {
    this.logOnCalls++;
    const outcome = FakeSteam.outcomes.shift() ?? "ok";
    setTimeout(() => {
      if (outcome !== "ok") return this.fail(outcome);
      this.steamID = {};
      this.emit("loggedOn");
    }, 0);
  }

  fail(eresult: number) {
    this.emit("error", Object.assign(new Error(`EResult ${eresult}`), { eresult }));
    this.steamID = null;
  }

  logOff() {
    this.steamID = null;
    setTimeout(() => this.emit("disconnected"), 0);
  }

  setPersona() {}
  gamesPlayed() {}
}

mock.module("steam-user", () => ({ default: FakeSteam, EConnectionProtocol: { WebSocket: 2 } }));
spyOn(console, "log").mockImplementation(() => {});

const { Bot } = await import("@/bot");

const account = { username: "alice", password: "secret", games: [730], online: false };
const del = mock(async () => {});
const tokens = { get: async () => undefined, set: async () => {}, del } as unknown as TokenService;

function createBot() {
  const bot = new Bot(account, tokens, "./.steam");
  return { bot, steam: bot.steam as unknown as FakeSteam };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await Bun.sleep(5);
  }
  throw new Error("Timed out waiting for condition");
}

beforeEach(() => {
  FakeSteam.outcomes = [];
  del.mockClear();
});

describe("Bot.run", () => {
  test("logs in once", async () => {
    const { bot, steam } = createBot();
    bot.run();

    await waitFor(() => steam.steamID !== null);
    expect(steam.logOnCalls).toBe(1);
  });

  test("stops without retrying on a fatal login error", async () => {
    FakeSteam.outcomes = [FakeSteam.EResult.InvalidPassword];
    const { bot, steam } = createBot();

    await bot.run();

    expect(steam.logOnCalls).toBe(1);
    expect(del).toHaveBeenCalledTimes(1);
  });

  test("logs in again after a dropped connection and keeps the token", async () => {
    const { bot, steam } = createBot();
    bot.run();
    await waitFor(() => steam.steamID !== null);

    steam.fail(FakeSteam.EResult.NoConnection);

    await waitFor(() => steam.logOnCalls === 2 && steam.steamID !== null);
    expect(del).not.toHaveBeenCalled();
  });

  test("deletes the token once when it is rejected after login", async () => {
    const { bot, steam } = createBot();
    bot.run();
    await waitFor(() => steam.steamID !== null);

    steam.fail(FakeSteam.EResult.AccessDenied);

    await waitFor(() => steam.logOnCalls === 2 && steam.steamID !== null);
    expect(del).toHaveBeenCalledTimes(1);
  });

  test("stops and keeps the token when the session is replaced", async () => {
    const { bot, steam } = createBot();
    const running = bot.run();
    await waitFor(() => steam.steamID !== null);

    steam.fail(FakeSteam.EResult.LogonSessionReplaced);

    await running;
    expect(steam.logOnCalls).toBe(1);
    expect(del).not.toHaveBeenCalled();
  });
});
