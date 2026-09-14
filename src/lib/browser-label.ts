import { userAgentIsNativeApp } from "./native/platform";

// Names the browser an error report came from, the way a person would say
// it: "Safari 26 · iPhone", "Instagram in-app browser · iPhone", "Picacho
// app · Android". Written for the error catcher (app-error-reporter.tsx),
// whose reports said nothing about the browser: three from one account on
// 2026-09-12 took two SQL round trips and a production build to place as a
// script injected into an iPhone browser, not our code. Here the report
// says where it happened in the first two lines.
//
// In-app browsers come first because they are the usual source of scripts
// that are not ours: Instagram, Facebook, TikTok and the rest open links in
// their own browser and inject code into the page. One we don't know by name
// still shows itself — Android marks its embedded browser "; wv)", and
// Apple's lacks the "Safari/" token every real Apple browser carries — so an
// unnamed one reads "unrecognised app's in-app browser", never "Safari".
//
// Versions: browsers' own major versions only. The OS version in a user
// agent is frozen these days (Chrome says Android 10 and macOS 10_15_7
// whatever they are; Safari 26 says iOS 18_6), so it is left out rather
// than reported wrong.

const IN_APP: Array<[RegExp, string]> = [
  [/\bInstagram\b/, "Instagram"],
  [/\bBarcelona\b/, "Threads"],
  [/FBAN\/MessengerForiOS|FB_IAB\/Orca-Android/, "Messenger"],
  [/FBAN\/|FB_IAB\/|FBAV\//, "Facebook"],
  [/musical_ly|BytedanceWebview|TikTok/, "TikTok"],
  [/Snapchat/, "Snapchat"],
  [/LinkedInApp/, "LinkedIn"],
  [/\bPinterest/, "Pinterest"],
  [/Telegram/, "Telegram"],
  [/TwitterAndroid|Twitter for iPhone/, "X"],
  [/\bLine\/\d/, "LINE"],
  [/MicroMessenger/, "WeChat"],
  [/\bGSA\/\d/, "Google app"],
];

// Order matters: Edge, Opera and Samsung Internet also say "Chrome/", and
// Chrome says "Safari/".
const BROWSERS: Array<[RegExp, string]> = [
  [/\bEdg(?:e|A|iOS)?\/(\d+)/, "Edge"],
  [/\b(?:OPR|OPiOS|OPT)\/(\d+)/, "Opera"],
  [/\bSamsungBrowser\/(\d+)/, "Samsung Internet"],
  [/\b(?:Firefox|FxiOS)\/(\d+)/, "Firefox"],
  [/\b(?:Chrome|CriOS)\/(\d+)/, "Chrome"],
  [/\bVersion\/(\d+)(?:\.\d+)*(?: Mobile\/\S+)? Safari\//, "Safari"],
];

function whichBrowser(ua: string): string {
  if (userAgentIsNativeApp(ua)) return "Picacho app";
  for (const [pattern, name] of IN_APP) {
    if (pattern.test(ua)) return `${name} in-app browser`;
  }
  if (/; wv\)/.test(ua) || (/AppleWebKit/.test(ua) && !/Safari\//.test(ua))) {
    return "unrecognised app's in-app browser";
  }
  for (const [pattern, name] of BROWSERS) {
    const match = ua.match(pattern);
    if (match) return match[1] ? `${name} ${match[1]}` : name;
  }
  return "unrecognised browser";
}

// touchPoints is navigator.maxTouchPoints: an iPad in Safari's default
// desktop mode sends a Mac's user agent, and only its touchscreen gives it
// away. Macs have none.
function whichDevice(ua: string, touchPoints: number): string {
  if (/iPad/.test(ua)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPod/.test(ua)) return "iPod";
  if (/Android/.test(ua)) return "Android";
  if (/CrOS/.test(ua)) return "Chromebook";
  if (/Macintosh|Mac OS X/.test(ua)) return touchPoints > 1 ? "iPad" : "Mac";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return "unknown device";
}

export function describeBrowser(userAgent: string, touchPoints = 0): string {
  if (!userAgent) return "not reported by the browser";
  return `${whichBrowser(userAgent)} · ${whichDevice(userAgent, touchPoints)}`;
}
