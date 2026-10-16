/**
 * API E2E — admin brand colours: saved as hex only, and served straight away
 * by the public settings endpoint the apps theme themselves from.
 */
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp, clearDatabase, bearer } from "./helpers/testApp.js";
import * as fx from "./helpers/fixtures.js";

jest.setTimeout(120000);

let app;
beforeAll(async () => {
  app = await startTestApp();
});
afterEach(clearDatabase);
afterAll(stopTestApp);

describe("settings: brand colours", () => {
  let A;
  beforeEach(async () => {
    A = bearer("admin", (await fx.createAdmin())._id);
  });
  const save = (body) => request(app).put("/api/settings").set("Authorization", A).send(body);
  const publicColors = async () => {
    const res = await request(app).get("/api/settings");
    const r = res.body.result || {};
    return { primaryColor: r.primaryColor, secondaryColor: r.secondaryColor };
  };

  it("saves hex colours and serves them publicly right away", async () => {
    await request(app).get("/api/settings"); // warm the settings cache first
    expect((await save({ primaryColor: "#08f7a7", secondaryColor: "#e41d07" })).status).toBe(200);
    expect(await publicColors()).toEqual({ primaryColor: "#08f7a7", secondaryColor: "#e41d07" });
    expect((await save({ primaryColor: "#0F8" })).status).toBe(200);
    expect((await publicColors()).primaryColor).toBe("#0F8");
  });

  it("rejects colours that are not hex codes", async () => {
    for (const bad of ["red", "#12", "#1234567", "rgb(1,2,3)", "url(javascript:alert(1))", "var(--x)"]) {
      const res = await save({ primaryColor: bad });
      expect([bad, res.status]).toEqual([bad, 400]);
    }
    expect((await save({ secondaryColor: "blue" })).status).toBe(400);
  });

  it("accepts an empty value to fall back to the default", async () => {
    expect((await save({ primaryColor: "" })).status).toBe(200);
    expect((await publicColors()).primaryColor).toBe("");
  });

  it("only admins can change colours", async () => {
    const seller = await fx.createSeller();
    const res = await request(app).put("/api/settings").set("Authorization", bearer("seller", seller._id)).send({ primaryColor: "#000000" });
    expect([401, 403]).toContain(res.status);
  });
});
