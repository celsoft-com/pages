import { describe, expect, it } from "vitest";
import type { Item } from "../types";
import { matchItem, parseQuery } from "./query";

const items: Item[] = [
  {
    id: "coat",
    title: "Winter Coat",
    price: 120,
    status: "draft",
    tags: ["outer", "sale"],
    author: { name: "Ada" },
  },
  { id: "hat", title: "Wool Hat", price: 30, status: "live", tags: ["accessory"], author: { name: "Bo" } },
  { id: "boot", title: "Snow Boot", price: 200, status: "live", image: "/assets/b.png", stock: 0 },
];

function search(query: string): string[] {
  const terms = parseQuery(query);
  return items.filter((item) => matchItem(item, terms)).map((item) => item.id);
}

describe("bare terms", () => {
  it("matches any field, case insensitively", () => {
    expect(search("winter")).toEqual(["coat"]);
    expect(search("WINTER")).toEqual(["coat"]);
  });

  it("matches the id as well as the fields", () => {
    expect(search("boot")).toEqual(["boot"]);
  });

  it("ands multiple terms together", () => {
    expect(search("wool hat")).toEqual(["hat"]);
    expect(search("wool coat")).toEqual([]);
  });

  it("treats a quoted phrase as one term", () => {
    expect(search('"snow boot"')).toEqual(["boot"]);
    expect(search("snow boot")).toEqual(["boot"]);
    expect(search('"boot snow"')).toEqual([]);
  });

  it("returns everything for an empty query", () => {
    expect(search("")).toEqual(["coat", "hat", "boot"]);
  });
});

describe("field terms", () => {
  it("matches part of a field with a colon", () => {
    expect(search("title:coat")).toEqual(["coat"]);
    expect(search("title:oo")).toEqual(["hat", "boot"]);
  });

  it("matches a field exactly with equals", () => {
    expect(search("status=live")).toEqual(["hat", "boot"]);
    expect(search("status=liv")).toEqual([]);
  });

  it("excludes with not-equals", () => {
    expect(search("status!=live")).toEqual(["coat"]);
  });

  it("requires the field to exist for not-equals", () => {
    expect(search("image!=nothing")).toEqual(["boot"]);
  });

  it("reaches nested fields with a dotted path", () => {
    expect(search("author.name:ad")).toEqual(["coat"]);
    expect(search("author.name=bo")).toEqual(["hat"]);
  });

  it("matches any element of an array field", () => {
    expect(search("tags:sale")).toEqual(["coat"]);
    expect(search("tags=accessory")).toEqual(["hat"]);
  });

  it("ignores an unknown field", () => {
    expect(search("nope:anything")).toEqual([]);
  });
});

describe("numeric comparison", () => {
  it("compares greater and less than", () => {
    expect(search("price>100")).toEqual(["coat", "boot"]);
    expect(search("price<100")).toEqual(["hat"]);
  });

  it("compares inclusive bounds", () => {
    expect(search("price>=120 price<=200")).toEqual(["coat", "boot"]);
    expect(search("price>=30 price<=30")).toEqual(["hat"]);
  });

  it("treats zero as a real value rather than missing", () => {
    expect(search("stock<1")).toEqual(["boot"]);
  });

  it("matches nothing when the bound is not a number", () => {
    expect(search("price>cheap")).toEqual([]);
  });
});

describe("presence and negation", () => {
  it("requires a field with has:", () => {
    expect(search("has:image")).toEqual(["boot"]);
  });

  it("requires a field with field:*", () => {
    expect(search("tags:*")).toEqual(["coat", "hat"]);
  });

  it("excludes matches with a leading dash", () => {
    expect(search("status=live -boot")).toEqual(["hat"]);
    expect(search("-has:image")).toEqual(["coat", "hat"]);
  });

  it("treats a lone dash as a literal term", () => {
    expect(search("-")).toEqual([]);
  });
});

describe("parseQuery", () => {
  it("lowercases values so matching is case insensitive", () => {
    expect(parseQuery("Status=Live")).toEqual([{ negated: false, field: "Status", op: "=", value: "live" }]);
  });

  it("rewrites has:field into a presence term", () => {
    expect(parseQuery("has:image")).toEqual([{ negated: false, field: "image", op: ":", value: "*" }]);
  });

  it("keeps a bare term fieldless", () => {
    expect(parseQuery("winter")).toEqual([{ negated: false, op: ":", value: "winter" }]);
  });

  it("collapses repeated whitespace", () => {
    expect(parseQuery("  a   b  ")).toHaveLength(2);
  });
});
