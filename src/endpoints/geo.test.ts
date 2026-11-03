import { testApp } from "@celsoft/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { clearGeoFetch, stubGeoFetch } from "../test/http";
import app from "../worker";

let t: Awaited<ReturnType<typeof testApp>>;
afterEach(async () => {
  clearGeoFetch();
  await t.close();
});

async function start(env?: Record<string, string>) {
  t = await testApp(app, env ? { env } : {});
  const owner = await t.signUp("owner@example.com");
  const stub = stubGeoFetch();
  const call = (name: string, input: Record<string, unknown>) => t.as(owner).call(name, input) as Promise<any>;
  return { owner, stub, call };
}

async function refusal(promise: Promise<unknown>): Promise<string | null> {
  return promise.then(
    () => null,
    (error) => `${(error as { status: number }).status} ${(error as Error).message}`,
  );
}

const STOPS = [
  { lat: 50.2612, lon: 10.9627 },
  { lat: 49.8917, lon: 10.8917 },
];

describe("geocode", () => {
  it("asks the public geocoder when the deploy has no key", async () => {
    const { call, stub } = await start();
    const result = await call("geocode", { query: "Springfield" });
    expect(result).toMatchObject({ provider: "nominatim", count: 2 });
    expect(stub.calls[0]).toContain("nominatim.openstreetmap.org");
  });

  it("asks openrouteservice with the deploy's key, in the same shape", async () => {
    const { call, stub } = await start({ ORS_API_KEY: "test" });
    const result = await call("geocode", { query: "Springfield" });
    expect(result.provider).toBe("openrouteservice");
    expect(stub.calls[0]).toContain("api_key=test");
  });
});

describe("route", () => {
  it("writes the line to an asset the page fetches, and returns only a summary", async () => {
    const { call } = await start();
    const result = await call("route", { stops: STOPS, path: "/trip/route.geojson", prefer: "safety" });
    expect(result).toMatchObject({ path: "/trip/route.geojson", provider: "brouter", profile: "cycling", points: 4 });
    expect(result.url).toMatch(/\/assets\/trip\/route\.geojson$/);
    expect(result.ways.analyzed_m).toBeGreaterThan(0);
    const served = await t.fetch("/assets/trip/route.geojson");
    expect(served.status).toBe(200);
    expect(((await served.json()) as { geometry: { type: string } }).geometry.type).toBe("LineString");
  });

  it("refuses prefer on a walking route rather than ignoring it", async () => {
    const { call } = await start();
    expect(
      await refusal(call("route", { stops: STOPS, path: "/walk.geojson", profile: "walking", prefer: "safety" })),
    ).toMatch(/^400 .*cycling/);
  });

  it("goes through openrouteservice with the deploy's key, which takes no prefer", async () => {
    const { call } = await start({ ORS_API_KEY: "test" });
    expect((await call("route", { stops: STOPS, path: "/ride.geojson" })).provider).toBe("openrouteservice");
    expect(await refusal(call("route", { stops: STOPS, path: "/ride.geojson", prefer: "safety" }))).toMatch(
      /^400 prefer "safety" is not available through openrouteservice/,
    );
  });

  it("needs write where the line is stored", async () => {
    await start();
    const guest = await t.signUp("guest@example.com");
    expect(await refusal(t.as(guest).call("route", { stops: STOPS, path: "/trip/route.geojson" }))).toMatch(/^404/);
  });
});
