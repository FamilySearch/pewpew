import { PAGE_LOGIN } from "../../types";

describe("GET /login (Login Page)", () => {
  describe("Error Display", () => {
    it("with ?error= should display the error on the login page", async () => {
      const errorValue = "access_denied";
      await browser.url(`${PAGE_LOGIN}?error=${encodeURIComponent(errorValue)}`);
      const heading = await $("h1");
      await expect(heading).toHaveText("Login Status");
      const bodyText = await $("body").getText();
      expect(bodyText).toContain(errorValue);
    });

    it("with ?error= and ?error_description= should display both", async () => {
      const errorValue = "access_denied";
      const errorDescription = "User denied access";
      await browser.url(`${PAGE_LOGIN}?error=${encodeURIComponent(errorValue)}&error_description=${encodeURIComponent(errorDescription)}`);
      const heading = await $("h1");
      await expect(heading).toHaveText("Login Status");
      const bodyText = await $("body").getText();
      expect(bodyText).toContain(errorValue);
      expect(bodyText).toContain(errorDescription);
    });
  });

  describe("Redirects", () => {
    it("with no params should redirect to the login API", async () => {
      await browser.url(PAGE_LOGIN);
      const url = await browser.getUrl();
      // The browser follows the redirect chain; final URL should include the auth provider
      // along with the original login page encoded as the state for post-login redirection
      expect(url).not.toContain(PAGE_LOGIN);
      expect(url).toContain(encodeURIComponent(PAGE_LOGIN));
    });

    it("with ?state= should eventually redirect away from login", async () => {
      const stateValue = "/test";
      await browser.url(`${PAGE_LOGIN}?state=${encodeURIComponent(stateValue)}`);
      const url = await browser.getUrl();
      // The browser follows the redirect chain; final URL should include the auth provider
      // along with the original login page encoded as the state for post-login redirection
      expect(url).not.toContain(PAGE_LOGIN);
      expect(url).toContain(encodeURIComponent(PAGE_LOGIN));
      expect(url).toContain(`state=${encodeURIComponent(stateValue)}`);
    });
  });
});
