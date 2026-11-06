import { describe, expect, it } from "vitest";
import {
  costText,
  dayAndTime,
  percentLeft,
  shortDuration,
  tookText,
} from "../src/sources/usageDisplay";

describe("costText", () => {
  it("shows dollars and cents", () => {
    expect(costText(0.12)).toBe("$0.12");
    expect(costText(1.5)).toBe("$1.50");
    expect(costText(0.006)).toBe("$0.01");
  });

  it("only looks free if it was", () => {
    expect(costText(0)).toBe("$0.00");
    expect(costText(0.002)).toBe("<$0.01");
  });
});

describe("tookText", () => {
  it("shows minutes only when there are some", () => {
    expect(tookText(45_000)).toBe("45s");
    expect(tookText(176_000)).toBe("2m 56s");
    expect(tookText(120_000)).toBe("2m 0s");
  });

  it("rounds up, so nothing takes no time", () => {
    expect(tookText(0)).toBe("1s");
    expect(tookText(44_100)).toBe("45s");
    expect(tookText(59_500)).toBe("1m 0s");
  });
});

describe("percentLeft", () => {
  it("rounds to the nearest percent", () => {
    expect(percentLeft(0.095, 0.5)).toBe(81);
    expect(percentLeft(0.25, 0.5)).toBe(50);
  });

  it("is only 0 or 100 when exactly that", () => {
    expect(percentLeft(0, 0.5)).toBe(100);
    expect(percentLeft(0.0001, 0.5)).toBe(99);
    expect(percentLeft(0.4999, 0.5)).toBe(1);
    expect(percentLeft(0.5, 0.5)).toBe(0);
  });

  it("handles going over the limit and a limit of nothing", () => {
    expect(percentLeft(0.7, 0.5)).toBe(0);
    expect(percentLeft(0, 0)).toBe(0);
  });
});

describe("shortDuration", () => {
  const minutes = 60_000;
  const hours = 60 * minutes;
  const days = 24 * hours;

  it("shows the two largest units", () => {
    expect(shortDuration(6 * days + 23 * hours + 40 * minutes)).toBe("6d 23h");
    expect(shortDuration(7 * days)).toBe("7d 0h");
    expect(shortDuration(23 * hours + 40 * minutes)).toBe("23h 40m");
    expect(shortDuration(40 * minutes)).toBe("40m");
  });

  it("rounds up, carrying into the next unit", () => {
    expect(shortDuration(59 * minutes + 1)).toBe("1h 0m");
    expect(shortDuration(1)).toBe("1m");
    expect(shortDuration(0)).toBe("1m");
  });
});

describe("dayAndTime", () => {
  const now = new Date(2026, 10, 6, 15, 0).getTime();

  it("names today and tomorrow by calendar day, not by hours away", () => {
    expect(dayAndTime(new Date(2026, 10, 6, 23, 0).getTime(), now)).toMatch(/^today at /);
    expect(dayAndTime(new Date(2026, 10, 7, 0, 30).getTime(), now)).toMatch(/^tomorrow at /);
    expect(dayAndTime(new Date(2026, 10, 7, 23, 0).getTime(), now)).toMatch(/^tomorrow at /);
  });

  it("gives a date further out", () => {
    const later = dayAndTime(new Date(2026, 10, 11, 13, 21).getTime(), now);
    expect(later).not.toMatch(/^(today|tomorrow)/);
    expect(later).toContain(" at ");
  });

  it("handles tomorrow falling in the next month", () => {
    const end = new Date(2026, 10, 30, 15, 0).getTime();
    expect(dayAndTime(new Date(2026, 11, 1, 9, 0).getTime(), end)).toMatch(/^tomorrow at /);
  });
});
