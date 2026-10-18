"use client";

import { Show, SignInButton, SignUpButton } from "@clerk/nextjs";
import { useState } from "react";

import { BudgetApp } from "~/components/budget-app";
import { Brand, Icon } from "~/components/ui";

export default function Home() {
  return (
    <>
      <Show when="signed-out">
        <Welcome />
      </Show>
      <Show when="signed-in">
        <BudgetApp />
      </Show>
    </>
  );
}

function Welcome() {
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  return (
    <main className="welcome">
      <section className="welcome-story">
        <Brand light />
        <div>
          <h1>
            A little clarity,
            <br />
            every day.
          </h1>
          <p className="intro">
            Your money has a purpose. Give it a place, keep the everyday in
            order, and make room for what matters.
          </p>
        </div>
        <p className="welcome-foot">
          <Icon name="shield" size={15} />
          Personal budgets. A shared understanding.
        </p>
      </section>
      <section className="welcome-form">
        <p className="eyebrow">Your money, together</p>
        <h2>Make yourself at home.</h2>
        <p>
          A calm place for your own budget, the expenses you share, and a short
          daily review.
        </p>
        <div className="welcome-actions">
          <SignUpButton mode="modal">
            <button
              className="primary-button"
              onClick={() => setMode("signup")}
              type="button"
            >
              Create your account <Icon name="arrow" size={16} />
            </button>
          </SignUpButton>
          <SignInButton mode="modal">
            <button
              className="secondary-button"
              onClick={() => setMode("signin")}
              type="button"
            >
              Sign in
            </button>
          </SignInButton>
        </div>
        <ul className="welcome-list">
          <li>
            <Icon name="budget" size={18} />
            <span>A cash-backed plan that you control</span>
          </li>
          <li>
            <Icon name="shared" size={18} />
            <span>Shared costs, with personal spending kept private</span>
          </li>
          <li>
            <Icon name="clock" size={18} />
            <span>One inbox for the things that need a look</span>
          </li>
        </ul>
        <span className="sr-only" aria-live="polite">
          {mode === "signup"
            ? "Create an account to start your budget."
            : "Sign in to return to your budget."}
        </span>
      </section>
    </main>
  );
}
