// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { AuthError } from "./lib/authService";
import { createFakeAuth, TEST_USER, type FakeAuth } from "./test/fakeAuth";
import { createFakeServices, renderWithApp } from "./test/fakeServices";

afterEach(cleanup);

const renderApp = (auth: FakeAuth, path = "/") => renderWithApp(auth, createFakeServices(), path);

describe("routing and access", () => {
  it("shows the landing page with the sign-up form to visitors", async () => {
    renderApp(createFakeAuth());
    expect(await screen.findByRole("form", { name: "Create account" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Code. Clash. Climb.");
    // The page renders before the login check finishes; the menu's Log in
    // button appears once it has, so wait for it rather than checking at once.
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(await within(nav).findByRole("link", { name: "Log in" })).toBeInTheDocument();
  });

  it("shows the logo in the menu, linking home, and on the landing page", async () => {
    renderApp(createFakeAuth());
    expect(await screen.findByRole("img", { name: "Code Wars" })).toHaveAttribute(
      "src",
      "/logo.png",
    );
    expect(screen.getByRole("link", { name: "Code Wars home" })).toHaveAttribute("href", "/");
  });

  it("gives signed-in players a bottom tab bar for phones", async () => {
    renderApp(createFakeAuth(TEST_USER), "/arena");
    const tabs = await screen.findByRole("navigation", { name: "Sections" });
    expect(within(tabs).getByRole("link", { name: "Arena" })).toHaveAttribute("href", "/arena");
    expect(within(tabs).getByRole("link", { name: "Rankings" })).toHaveAttribute(
      "href",
      "/rankings",
    );
    expect(within(tabs).getByRole("link", { name: "Profile" })).toHaveAttribute(
      "href",
      "/u/coder_42",
    );
    expect(tabs).toHaveClass("md:hidden");
  });

  it("has no bottom tab bar for visitors", async () => {
    renderApp(createFakeAuth());
    await screen.findByRole("form", { name: "Create account" });
    expect(screen.queryByRole("navigation", { name: "Sections" })).not.toBeInTheDocument();
  });

  it("sends signed-out visitors from the arena to log in, then back", async () => {
    const auth = createFakeAuth();
    renderApp(auth, "/arena");
    expect(await screen.findByRole("form", { name: "Log in" })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "a@example.test");
    await user.type(screen.getByLabelText("Password"), "secret1");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText("coder_42", { selector: "h1" })).toBeInTheDocument();
    expect(auth.signIn).toHaveBeenCalledWith("a@example.test", "secret1");
  });

  it("takes signed-in users straight to the arena and shows their rating", async () => {
    renderApp(createFakeAuth(TEST_USER), "/");
    expect(await screen.findByText("coder_42", { selector: "h1" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Main" });
    await waitFor(() => expect(nav).toHaveTextContent("1216"));
    expect(nav).toHaveTextContent("Arena");
  });

  it("logs out and returns to the landing page", async () => {
    const auth = createFakeAuth(TEST_USER);
    renderApp(auth, "/arena");
    await userEvent.click(await screen.findByRole("button", { name: "Log out" }));
    expect(await screen.findByRole("form", { name: "Create account" })).toBeInTheDocument();
    expect(auth.signOut).toHaveBeenCalled();
  });

  it("shows a not-found page for unknown addresses", async () => {
    renderApp(createFakeAuth(), "/nope");
    expect(await screen.findByText("Page not found")).toBeInTheDocument();
  });
});

describe("log in", () => {
  it("shows a clear message for wrong credentials", async () => {
    const auth = createFakeAuth();
    auth.signIn = async () => {
      throw new AuthError("Wrong email or password.");
    };
    renderApp(auth, "/login");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email"), "a@example.test");
    await user.type(screen.getByLabelText("Password"), "nope");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong email or password.");
    expect(screen.getByRole("form", { name: "Log in" })).toBeInTheDocument();
  });
});

describe("sign up", () => {
  async function fill(email: string, username: string, password: string) {
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email"), email);
    await user.type(screen.getByLabelText("Username"), username);
    await user.type(screen.getByLabelText("Password"), password);
    return user;
  }
  const submit = () => screen.getByRole("button", { name: "Create account" });

  it("creates the account with the username and enters the arena", async () => {
    const auth = createFakeAuth();
    renderApp(auth);
    const user = await fill("new@example.test", "coder_42", "secret1");
    await user.click(submit());
    expect(await screen.findByText("coder_42", { selector: "h1" })).toBeInTheDocument();
    expect(auth.signUp).toHaveBeenCalledWith("new@example.test", "secret1", "coder_42");
  });

  it("checks the username when leaving the field", async () => {
    const auth = createFakeAuth();
    renderApp(auth);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Username"), "coder_42");
    await user.tab();
    expect(await screen.findByText("Available.")).toBeInTheDocument();
    expect(auth.isUsernameAvailable).toHaveBeenCalledWith("coder_42");
  });

  it("blocks invalid usernames without asking the server", async () => {
    const auth = createFakeAuth();
    renderApp(auth);
    const user = await fill("new@example.test", "a b", "secret1");
    await user.click(submit());
    expect(await screen.findByText(/Use 3 to 20 letters/)).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toHaveAttribute("aria-invalid", "true");
    expect(auth.isUsernameAvailable).not.toHaveBeenCalled();
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("blocks taken usernames", async () => {
    const auth = createFakeAuth();
    auth.isUsernameAvailable = async () => false;
    renderApp(auth);
    const user = await fill("new@example.test", "taken_name", "secret1");
    await user.click(submit());
    expect(await screen.findByText("That username is taken.")).toBeInTheDocument();
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("blocks short passwords", async () => {
    const auth = createFakeAuth();
    renderApp(auth);
    const user = await fill("new@example.test", "coder_42", "123");
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent("at least 6 characters");
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("shows the server's reason when sign-up fails", async () => {
    const auth = createFakeAuth();
    auth.signUp = async () => {
      throw new AuthError("An account with this email already exists.");
    };
    renderApp(auth);
    const user = await fill("dup@example.test", "coder_42", "secret1");
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
  });

  it("asks the user to confirm their email when confirmation is switched on", async () => {
    const auth = createFakeAuth();
    auth.signUp = async () => ({ needsEmailConfirmation: true });
    renderApp(auth);
    const user = await fill("new@example.test", "coder_42", "secret1");
    await user.click(submit());
    expect(await screen.findByRole("status")).toHaveTextContent("Check your email");
  });
});
