// Timing intelligence guardrails from spec section 6: optimal posting windows,
// daily frequency cap, and minimum spacing between posts.

import { OPTIMAL_POST_WINDOWS, MAX_POSTS_PER_DAY_RECOMMENDED, MIN_HOURS_BETWEEN_POSTS } from "./constants.js";

/** Is the given Date inside one of the optimal posting windows (local time)? */
export function isWithinOptimalWindow(date = new Date()) {
  const day = date.getDay();
  const hour = date.getHours();
  return OPTIMAL_POST_WINDOWS.some((w) => w.days.includes(day) && hour >= w.startHour && hour < w.endHour);
}

export function nextOptimalWindowLabel() {
  return "Tue\u2013Thu, 8\u201310am or 7\u20139pm";
}

/**
 * Given a list of past post timestamps (ms epoch) for a Page, decide whether posting
 * "now" would trip the frequency cap or spacing guidance.
 */
export function checkPostingCadence(history, now = Date.now()) {
  const warnings = [];
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const postsToday = history.filter((h) => h.at >= oneDayAgo).length;
  if (postsToday >= MAX_POSTS_PER_DAY_RECOMMENDED) {
    warnings.push({
      code: "frequency_cap",
      severity: "warn",
      message: `You've already posted ${postsToday} time(s) in the last 24 hours. Posting more than ${MAX_POSTS_PER_DAY_RECOMMENDED}/day risks algorithmic suppression.`,
    });
  }

  const mostRecent = history[0];
  if (mostRecent) {
    const hoursSince = (now - mostRecent.at) / (1000 * 60 * 60);
    if (hoursSince < MIN_HOURS_BETWEEN_POSTS) {
      warnings.push({
        code: "too_soon",
        severity: "warn",
        message: `Last post was ${hoursSince.toFixed(1)}h ago. A ${MIN_HOURS_BETWEEN_POSTS}h gap between posts is recommended.`,
      });
    }
  }

  if (!isWithinOptimalWindow(new Date(now))) {
    warnings.push({
      code: "off_peak",
      severity: "info",
      message: `Outside the optimal posting window (${nextOptimalWindowLabel()}). Consider scheduling instead.`,
    });
  }

  return warnings;
}
