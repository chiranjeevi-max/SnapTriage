/**
 * @module features/dev-tools/data-mode
 *
 * The dev-only switch between demo data and the worst case.
 *
 * The selection lives in the `data` query parameter, so a reload keeps it and
 * a link can carry it. Nothing here renders in production: the toggle is
 * mounted only when `NODE_ENV` is `development`, and the fixture data lives
 * in a separate chunk that production never downloads.
 */
"use client";

import { useEffect, useState } from "react";
import type {
  FixtureAccount,
  FixtureAvailableRepo,
  FixtureIssue,
  FixtureRepo,
  FixtureView,
} from "./fixtures";

/** The datasets the toggle switches between. */
export type DataMode = "demo" | "worst" | "empty" | "one" | "many";

/** Every mode the toggle offers, in order. */
export const DATA_MODES: DataMode[] = ["demo", "worst", "empty", "one", "many"];

/** Event fired when the mode changes. */
const MODE_EVENT = "snaptriage:data-mode";

/**
 * Reads the current mode from the URL.
 *
 * @returns The mode, or `demo` when the parameter is missing or unknown.
 */
export function readDataMode(): DataMode {
  if (typeof window === "undefined") return "demo";
  const value = new URLSearchParams(window.location.search).get("data");
  return DATA_MODES.includes(value as DataMode) ? (value as DataMode) : "demo";
}

/**
 * Writes the mode to the URL and tells the page that it changed.
 *
 * @param mode - The mode to switch to.
 */
export function writeDataMode(mode: DataMode) {
  const url = new URL(window.location.href);
  if (mode === "demo") {
    url.searchParams.delete("data");
  } else {
    url.searchParams.set("data", mode);
  }
  window.history.replaceState(null, "", url);
  window.dispatchEvent(new Event(MODE_EVENT));
}

/**
 * Subscribes to the current mode.
 *
 * @returns The active mode.
 */
export function useDataMode(): DataMode {
  const [mode, setMode] = useState<DataMode>("demo");

  useEffect(() => {
    const update = () => setMode(readDataMode());
    update();
    window.addEventListener(MODE_EVENT, update);
    return () => window.removeEventListener(MODE_EVENT, update);
  }, []);

  return mode;
}

/**
 * Loads the fixture module for a mode.
 *
 * The import is dynamic on purpose: the fixtures are development-only data
 * and must not sit in the bundle every visitor downloads. The specifier is a
 * literal, so renaming the module still breaks the build rather than the
 * runtime.
 *
 * @param mode - The active mode.
 * @returns The fixture module, or `null` when the real data should be used.
 */
async function loadFixtures(mode: DataMode) {
  if (process.env.NODE_ENV !== "development" || mode === "demo") return null;
  return import("./fixtures");
}

/**
 * Returns the worst-case issues for a mode.
 *
 * @param mode - The active mode.
 * @returns The issues, or `null` when the real data should be used.
 */
export async function devIssues(mode: DataMode): Promise<FixtureIssue[] | null> {
  const fixtures = await loadFixtures(mode);
  return fixtures?.issuesForMode(mode) ?? null;
}

/**
 * Returns the worst-case repositories for a mode.
 *
 * @param mode - The active mode.
 * @returns The repositories, or `null` when the real data should be used.
 */
export async function devRepos(mode: DataMode): Promise<FixtureRepo[] | null> {
  const fixtures = await loadFixtures(mode);
  return fixtures?.reposForMode(mode) ?? null;
}

/**
 * Returns the worst-case accounts for a mode.
 *
 * @param mode - The active mode.
 * @returns The accounts, or `null` when the real data should be used.
 */
export async function devAccounts(mode: DataMode): Promise<FixtureAccount[] | null> {
  const fixtures = await loadFixtures(mode);
  return fixtures?.accountsForMode(mode) ?? null;
}

/**
 * Returns the worst-case browsable repositories for a mode.
 *
 * @param mode - The active mode.
 * @returns The repositories, or `null` when the real data should be used.
 */
export async function devAvailableRepos(mode: DataMode): Promise<FixtureAvailableRepo[] | null> {
  const fixtures = await loadFixtures(mode);
  return fixtures?.availableReposForMode(mode) ?? null;
}

/**
 * Returns the worst-case saved views for a mode.
 *
 * @param mode - The active mode.
 * @returns The views, or `null` when the real data should be used.
 */
export async function devViews(mode: DataMode): Promise<FixtureView[] | null> {
  const fixtures = await loadFixtures(mode);
  return fixtures?.viewsForMode(mode) ?? null;
}
