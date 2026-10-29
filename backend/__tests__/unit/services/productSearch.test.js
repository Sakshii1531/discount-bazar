import { expandSearchTerm } from "../../../app/services/productSearchService.js";

const words = (variant) => variant.map((entry) => entry.word).join(" ");

describe("services/productSearchService expandSearchTerm", () => {
  it("returns nothing for a blank term", () => {
    expect(expandSearchTerm("   ")).toEqual([]);
  });

  it("keeps a term without known names as the only variant", () => {
    expect(expandSearchTerm(" Basmati  Rice-X ").map(words)).toEqual(["Basmati Rice-X"]);
  });

  it("swaps the longest known phrase, ignoring case and doubled letters", () => {
    expect(expandSearchTerm("Lal Mirch powder").map(words)).toEqual(["Lal Mirch powder", "red chilli powder"]);
    expect(expandSearchTerm("RED CHILI").map(words)).toEqual(["RED CHILI", "lal mirch"]);
    expect(expandSearchTerm("kali mirch").map(words)).toEqual(["kali mirch", "black pepper"]);
  });

  it("flags swapped-in words as whole-word matches only", () => {
    const [, translated] = expandSearchTerm("haldi powder");
    expect(translated).toEqual([
      { word: "turmeric", wholeWord: true },
      { word: "powder", wholeWord: false },
    ]);
  });
});
