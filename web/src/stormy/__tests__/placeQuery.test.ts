import { describe, expect, it } from "vitest";
import { chooseNearby, hitsForPlace, matchClarifiedChoice, preparePlaceQuery, type NearbyHit } from "../placeQuery";

const mcdonalds: NearbyHit[] = [
  {
    id: "far-road",
    name: "McDonald Road",
    detail: "Rural road, Ontario, Canada",
    featureType: "street",
    distanceMeters: 900_000,
  },
  {
    id: "close",
    name: "McDonald's",
    detail: "Eldorado Road, Decatur, IL",
    featureType: "poi",
    distanceMeters: 600,
  },
  {
    id: "also",
    name: "McDonald's",
    detail: "Main Street, Decatur, IL",
    featureType: "poi",
    distanceMeters: 2400,
  },
];

describe("preparePlaceQuery", () => {
  it("drops nearest and searches the business", () => {
    expect(preparePlaceQuery("the nearest McDonald's")).toMatchObject({
      query: "McDonald's",
      wantClosest: true,
      preferPoi: true,
    });
  });

  it("keeps a street address as an address", () => {
    expect(preparePlaceQuery("123 McDonald Road").preferPoi).toBe(false);
  });
});

describe("hitsForPlace", () => {
  it("keeps the nearby restaurant and drops the road in another country", () => {
    const prepared = preparePlaceQuery("the nearest McDonald's");
    const hits = hitsForPlace(prepared.query, mcdonalds, prepared);
    expect(hits.map((hit) => hit.id)).toEqual(["close", "also"]);
  });
});

describe("chooseNearby", () => {
  it("picks the closest when the next one is farther", () => {
    const hits = hitsForPlace("McDonald's", mcdonalds, preparePlaceQuery("nearest McDonald's"));
    expect(chooseNearby(hits, true)).toEqual({ kind: "pick", id: "close" });
  });

  it("asks when two businesses are neck and neck", () => {
    const hits: NearbyHit[] = [
      { id: "a", name: "McDonald's", detail: "Eldorado Road", featureType: "poi", distanceMeters: 400 },
      { id: "b", name: "McDonald's", detail: "Main Street", featureType: "poi", distanceMeters: 520 },
    ];
    const choice = chooseNearby(hits, true);
    expect(choice.kind).toBe("ask");
    if (choice.kind !== "ask") return;
    expect(choice.say).toContain("Eldorado");
    expect(choice.say).toContain("Main");
    expect(choice.say.endsWith("?")).toBe(true);
  });
});

describe("matchClarifiedChoice", () => {
  const hits = [
    mcdonalds[1]!,
    mcdonalds[2]!,
  ];

  it("hears the street she named", () => {
    expect(matchClarifiedChoice("The one on Eldorado", hits)).toBe("close");
    expect(matchClarifiedChoice("Main", hits)).toBe("also");
  });

  it("hears closest and the other one", () => {
    expect(matchClarifiedChoice("the closest", hits)).toBe("close");
    expect(matchClarifiedChoice("the other one", hits)).toBe("also");
  });
});
