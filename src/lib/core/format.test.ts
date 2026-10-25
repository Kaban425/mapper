import { describe, expect, it } from "vitest";

import {
  formatDuration,
  formatError,
  formatMeters,
  formatNumber,
  formatPx,
  formatSignedMeters,
  formatSpeedKmh,
  formatSpeedMps,
} from "./format";
import { kmhToMps, travelSeconds } from "./travel";

const NARROW = " ";
const NBSP = " ";

describe("numbers", () => {
  it("groups Russian thousands with a narrow no-break space", () => {
    expect(formatNumber(1240, "ru")).toBe(`1${NARROW}240`);
    expect(formatNumber(1240, "en")).toBe("1,240");
  });

  it("uses the decimal separator of the language", () => {
    expect(formatSpeedMps(6.3, "ru")).toBe(`6,3${NBSP}м/с`);
    expect(formatSpeedMps(6.3, "en")).toBe(`6.3${NBSP}m/s`);
    expect(formatPx(170.44, "ru")).toBe(`170,4${NBSP}px`);
  });

  it("writes metres, errors, heights and speeds", () => {
    expect(formatMeters(1239.6, "ru")).toBe(`1${NARROW}240${NBSP}м`);
    expect(formatMeters(412.2, "en")).toBe(`412${NBSP}m`);
    expect(formatError(0.2, "ru")).toBe(`±${NBSP}1${NBSP}м`);
    expect(formatError(15.6, "en")).toBe(`±${NBSP}16${NBSP}m`);
    expect(formatSignedMeters(35, "ru")).toBe(`+35${NBSP}м`);
    expect(formatSignedMeters(-12, "en")).toBe(`−12${NBSP}m`);
    expect(formatSignedMeters(0, "ru")).toBe(`+0${NBSP}м`);
    expect(formatSpeedKmh(100, "ru")).toBe(`100${NBSP}км/ч`);
  });

  it("uses a real minus sign", () => {
    expect(formatNumber(-5, "en")).toBe("−5");
  });
});

describe("durations", () => {
  it("writes m:ss, and h:mm:ss from an hour", () => {
    expect(formatDuration(65.4)).toBe("1:05");
    expect(formatDuration(9)).toBe("0:09");
    expect(formatDuration(3727)).toBe("1:02:07");
    expect(formatDuration(-3)).toBe("0:00");
  });
});

describe("travel", () => {
  it("divides the route by the speed", () => {
    expect(travelSeconds(630, 6.3)).toBeCloseTo(100);
    expect(travelSeconds(1000, kmhToMps(100))).toBeCloseTo(36);
    expect(travelSeconds(500, 0)).toBe(0);
    expect(travelSeconds(Number.NaN, 6.3)).toBe(0);
  });
});
