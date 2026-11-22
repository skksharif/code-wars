// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    expect(await screen.findByRole("img", { name: "Clash of Coders" })).toHaveAttribute(
      "src",
      "/logo-mark.png",
    );
    expect(screen.getByRole("link", { name: "Clash of Coders home" })).toHaveAttribute("href", "/");
  });

  describe("phone menu", () => {
    it("also links to the Arena and the Rankings", async () => {
      renderApp(createFakeAuth(TEST_USER), "/arena");
      await userEvent.click(await screen.findByRole("button", { name: "Menu" }));
      const menu = screen.getByRole("navigation", { name: "Account" });
      expect(within(menu).getByRole("link", { name: "Arena" })).toHaveAttribute("href", "/arena");
      await userEvent.click(within(menu).getByRole("link", { name: "Rankings" }));
      expect(await screen.findByRole("heading", { name: "Global rankings" })).toBeInTheDocument();
      expect(screen.queryByRole("navigation", { name: "Account" })).not.toBeInTheDocument();
    });

    it("opens from the hamburger with Profile and Log out", async () => {
      renderApp(createFakeAuth(TEST_USER), "/arena");
      const toggle = await screen.findByRole("button", { name: "Menu" });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("navigation", { name: "Account" })).not.toBeInTheDocument();

      await userEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      const menu = screen.getByRole("navigation", { name: "Account" });
      const profile = await within(menu).findByRole("link", { name: /Profile/ });
      expect(profile).toHaveAttribute("href", "/u/coder_42");
      expect(profile).toHaveTextContent("coder_42 · 1216");
      expect(within(menu).getByRole("button", { name: "Log out" })).toBeInTheDocument();
    });

    it("goes to your profile and closes", async () => {
      renderApp(createFakeAuth(TEST_USER), "/arena");
      await userEvent.click(await screen.findByRole("button", { name: "Menu" }));
      const menu = screen.getByRole("navigation", { name: "Account" });
      await userEvent.click(await within(menu).findByRole("link", { name: /Profile/ }));
      expect(await screen.findByRole("button", { name: "Menu" })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      expect(screen.queryByRole("navigation", { name: "Account" })).not.toBeInTheDocument();
    });

    it("logs out from the menu", async () => {
      const auth = createFakeAuth(TEST_USER);
      renderApp(auth, "/arena");
      await userEvent.click(await screen.findByRole("button", { name: "Menu" }));
      const menu = screen.getByRole("navigation", { name: "Account" });
      await userEvent.click(within(menu).getByRole("button", { name: "Log out" }));
      expect(await screen.findByRole("form", { name: "Create account" })).toBeInTheDocument();
      expect(auth.signOut).toHaveBeenCalled();
    });

    it("closes on Escape or a tap outside", async () => {
      renderApp(createFakeAuth(TEST_USER), "/arena");
      const toggle = await screen.findByRole("button", { name: "Menu" });
      await userEvent.click(toggle);
      await userEvent.keyboard("{Escape}");
      expect(toggle).toHaveAttribute("aria-expanded", "false");

      await userEvent.click(toggle);
      await userEvent.click(screen.getByRole("heading", { level: 1 }));
      expect(toggle).toHaveAttribute("aria-expanded", "false");
    });

    it("is not shown to visitors", async () => {
      renderApp(createFakeAuth());
      await screen.findByRole("form", { name: "Create account" });
      expect(screen.queryByRole("button", { name: "Menu" })).not.toBeInTheDocument();
    });
  });

  it("puts Arena, Rankings and Friends in the bottom bar for signed-in players", async () => {
    renderApp(createFakeAuth(TEST_USER), "/arena");
    const tabs = await screen.findByRole("navigation", { name: "Sections" });
    expect(within(tabs).getByRole("link", { name: "Arena" })).toHaveAttribute("href", "/arena");
    expect(within(tabs).getByRole("link", { name: "Rankings" })).toHaveAttribute(
      "href",
      "/rankings",
    );
    expect(within(tabs).getByRole("link", { name: "Friends" })).toHaveAttribute("href", "/friends");
    expect(within(tabs).getAllByRole("link")).toHaveLength(3);
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
  });

  it("keeps the top bar to your profile and Log out", async () => {
    renderApp(createFakeAuth(TEST_USER), "/arena");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    const profile = await within(nav).findByRole("link", { name: "Your profile, rating 1216" });
    expect(profile).toHaveAttribute("href", "/u/coder_42");
    expect(within(nav).getAllByRole("link")).toHaveLength(1);
    expect(within(nav).getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("logs out and returns to the landing page, leaving the online lobby", async () => {
    const auth = createFakeAuth(TEST_USER);
    const services = createFakeServices();
    renderWithApp(auth, services, "/arena");
    await waitFor(() => expect(services.lobby).toHaveLength(1));
    await userEvent.click(await screen.findByRole("button", { name: "Log out" }));
    expect(await screen.findByRole("form", { name: "Create account" })).toBeInTheDocument();
    expect(auth.signOut).toHaveBeenCalled();
    expect(services.lobby).toHaveLength(0);
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

describe("lobby", () => {
  it("switches between Sign up and Log in on the same card", async () => {
    renderApp(createFakeAuth());
    const account = await screen.findByRole("navigation", { name: "Account" });
    expect(within(account).getByRole("link", { name: "Sign up" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const user = userEvent.setup();
    await user.click(within(account).getByRole("link", { name: "Log in" }));
    expect(await screen.findByRole("form", { name: "Log in" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Code. Clash. Climb.");
    // Each tab is its own page, so look the card up again.
    const again = screen.getByRole("navigation", { name: "Account" });
    await user.click(within(again).getByRole("link", { name: "Sign up" }));
    expect(await screen.findByRole("form", { name: "Create account" })).toBeInTheDocument();
  });

  it("shows live numbers and the top three", async () => {
    const services = createFakeServices();
    services.lobbyStats = { players: 42, battlesToday: 1 };
    services.leaderboard = [
      {
        id: "u1",
        username: "alpha",
        avatar: "nova",
        rating: 1340,
        wins: 5,
        losses: 1,
        draws: 0,
        rank: 1,
      },
      {
        id: "u2",
        username: "bravo",
        avatar: "echo",
        rating: 1290,
        wins: 3,
        losses: 2,
        draws: 0,
        rank: 2,
      },
    ];
    renderWithApp(createFakeAuth(), services, "/");
    expect(await screen.findByText("players")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText(/battle today/)).toBeInTheDocument();
    const top = await screen.findByRole("region", { name: "Top players" });
    expect(within(top).getByRole("link", { name: "alpha" })).toHaveAttribute("href", "/u/alpha");
    expect(within(top).getByText("1340")).toBeInTheDocument();
  });

  it("invites the first winner when the board is empty", async () => {
    renderApp(createFakeAuth());
    const top = await screen.findByRole("region", { name: "Top players" });
    expect(top).toHaveTextContent("The board is empty");
  });
});

describe("log in extras", () => {
  it("shows and hides the password", async () => {
    renderApp(createFakeAuth(), "/login");
    const user = userEvent.setup();
    const field = await screen.findByLabelText("Password");
    expect(field).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(field).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(field).toHaveAttribute("type", "password");
  });

  it("resets a forgotten password with an emailed code, then enters the arena", async () => {
    const auth = createFakeAuth();
    renderApp(auth, "/login");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email"), "a@example.test");
    await user.click(screen.getByRole("button", { name: "Forgot password?" }));
    const ask = await screen.findByRole("form", { name: "Reset password" });
    expect(within(ask).getByLabelText("Email")).toHaveValue("a@example.test");
    await user.click(within(ask).getByRole("button", { name: "Send code" }));
    expect(auth.requestPasswordReset).toHaveBeenCalledWith("a@example.test");

    const form = await screen.findByRole("form", { name: "Choose a new password" });
    await user.type(within(form).getByLabelText("Code from the email"), "12 34ab56");
    await user.type(within(form).getByLabelText("New password"), "newpass9");
    await user.click(within(form).getByRole("button", { name: "Save and log in" }));
    expect(auth.resetPassword).toHaveBeenCalledWith("a@example.test", "123456", "newpass9");
    expect(await screen.findByText("coder_42", { selector: "h1" })).toBeInTheDocument();
  });

  it("explains a wrong reset code", async () => {
    const auth = createFakeAuth();
    auth.resetPassword = vi.fn(async () => {
      throw new AuthError("That code is wrong or has expired.");
    });
    renderApp(auth, "/login");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Forgot password?" }));
    await user.type(screen.getByLabelText("Email"), "a@example.test");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await user.type(await screen.findByLabelText("Code from the email"), "000000");
    await user.type(screen.getByLabelText("New password"), "newpass9");
    await user.click(screen.getByRole("button", { name: "Save and log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("wrong or has expired");
  });
});

describe("sign up", () => {
  it("sends the chosen avatar with the account", async () => {
    const auth = createFakeAuth();
    renderApp(auth);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email"), "new@example.test");
    await user.type(screen.getByLabelText("Username"), "coder_42");
    await user.type(screen.getByLabelText("Password"), "secret1");
    await user.click(screen.getByRole("radio", { name: "Pixel" }));
    expect(screen.getByRole("radio", { name: "Pixel" })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() =>
      expect(auth.signUp).toHaveBeenCalledWith("new@example.test", "secret1", "coder_42", "pixel"),
    );
  });

  it("checks the username while typing, without leaving the field", async () => {
    const auth = createFakeAuth();
    auth.isUsernameAvailable = vi.fn(async (name: string) => name !== "taken_one");
    renderApp(auth);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Username"), "taken_one");
    expect(await screen.findByText("That username is taken.")).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toHaveFocus();
  });

  it("rates the new password's strength", async () => {
    renderApp(createFakeAuth());
    const user = userEvent.setup();
    const field = await screen.findByLabelText("Password");
    await user.type(field, "abcdef");
    expect(screen.getByText("Weak")).toBeInTheDocument();
    await user.type(field, "GH12!");
    expect(screen.getByText("Strong")).toBeInTheDocument();
  });

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
    expect(auth.signUp).toHaveBeenCalledWith(
      "new@example.test",
      "secret1",
      "coder_42",
      expect.any(String),
    );
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

  describe("email code", () => {
    const needsCode = () => {
      const auth = createFakeAuth();
      auth.signUp = vi.fn(async () => ({ needsEmailConfirmation: true }));
      return auth;
    };
    async function reachCodeStep(auth: FakeAuth) {
      renderApp(auth);
      const user = await fill(" new@example.test ", "coder_42", "secret1");
      await user.click(submit());
      await screen.findByRole("form", { name: "Confirm your email" });
      return user;
    }

    it("asks for the 6-digit code sent to the email", async () => {
      await reachCodeStep(needsCode());
      expect(screen.getByText("new@example.test")).toBeInTheDocument();
      expect(screen.getByLabelText("6-digit code")).toHaveFocus();
      expect(screen.getByRole("button", { name: "Send a new code in 60s" })).toBeDisabled();
    });

    it("confirms the account as soon as the last digit is typed, then enters the arena", async () => {
      const auth = needsCode();
      const user = await reachCodeStep(auth);
      await user.type(screen.getByLabelText("6-digit code"), "48 29a13");
      expect(await screen.findByText("coder_42", { selector: "h1" })).toBeInTheDocument();
      expect(auth.verifySignUpCode).toHaveBeenCalledTimes(1);
      expect(auth.verifySignUpCode).toHaveBeenCalledWith("new@example.test", "482913");
    });

    it("explains a wrong code and lets the player try another", async () => {
      const auth = needsCode();
      auth.verifySignUpCode = vi
        .fn()
        .mockRejectedValueOnce(new AuthError("That code is wrong or has expired."))
        .mockImplementationOnce(async () => auth.emit(TEST_USER));
      const user = await reachCodeStep(auth);
      const input = screen.getByLabelText("6-digit code");
      await user.type(input, "111111");
      expect(await screen.findByRole("alert")).toHaveTextContent("wrong or has expired");
      await user.clear(input);
      await user.type(input, "222222");
      expect(await screen.findByText("coder_42", { selector: "h1" })).toBeInTheDocument();
      expect(auth.verifySignUpCode).toHaveBeenLastCalledWith("new@example.test", "222222");
    });

    it("sends a new code after the wait", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const auth = needsCode();
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        renderApp(auth);
        await user.type(await screen.findByLabelText("Email"), "new@example.test");
        await user.type(screen.getByLabelText("Username"), "coder_42");
        await user.type(screen.getByLabelText("Password"), "secret1");
        await user.click(submit());
        await screen.findByRole("form", { name: "Confirm your email" });
        for (let i = 0; i < 61; i++) {
          await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
          });
        }
        await user.click(screen.getByRole("button", { name: "Send a new code" }));
        expect(auth.resendSignUpCode).toHaveBeenCalledWith("new@example.test");
        expect(await screen.findByRole("status")).toHaveTextContent("A new code is on its way");
        expect(screen.getByRole("button", { name: /Send a new code in/ })).toBeDisabled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("goes back to fix the email, keeping what was typed", async () => {
      const user = await reachCodeStep(needsCode());
      await user.click(screen.getByRole("button", { name: "Wrong email? Go back" }));
      expect(screen.getByLabelText("Email")).toHaveValue("new@example.test");
      expect(screen.getByLabelText("Username")).toHaveValue("coder_42");
    });
  });
});
