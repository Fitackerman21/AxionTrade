/**
 * What the room actually knows about the platform (spec §9.2).
 *
 * The failure this module exists for is not a bad sentence, it is the absence of an
 * answer. Measured on the live room: six messages from a newcomer, six replies, and by
 * the room's own `contentTokens` none of the six shared a content word with what was
 * asked. Every product question was routed to `PRODUCT_LINES`, a bank of twenty-five
 * *testimonials* shared by all eleven members — so "how do i put money in btw" could only
 * ever come back as "worth it for me", and the persona texture the sheets work so hard for
 * collapsed to one voice exactly where a newcomer first lands.
 *
 * Two things were missing and both are here:
 *
 *  1. **Facts.** A persona holding no product fact can only praise, deflect or invent, and
 *     all three read as a bot on a page about the product. `facts` is the reviewed, accurate
 *     description of how the platform works — the funded balance, the portion released to
 *     AxAI, the loss limit and the profit goal, and the fact that the unreleased balance is
 *     not traded. It is the *only* product material a model is given on this shape of turn,
 *     which is what makes "no invented claim" enforceable rather than aspirational.
 *
 *  2. **Answers in more than one voice.** Each question shape carries a pool per length
 *     tier, the way `REPERTOIRE` does, plus `personal` lines in named members' own words
 *     for the questions a newcomer actually asks. A fallback that answers the question is
 *     worth more than one that praises the product, and eleven members who each answer it
 *     their own way is what stops the room reading as one account.
 *
 * The classifier is deliberately keyword-based and deterministic: the same message must
 * route to the same answer on a replay, and the room may not spend a model call deciding
 * what a question was about. `agenda.ts` decides *whether* a message is about the platform
 * (`asksAboutProduct`); this module decides *which* question it is.
 */

import type { PersonaId } from "./types";

/** The question shapes the room can actually answer. */
export type ProductIntent =
  | "how-it-works"
  | "autonomy"
  | "deposit"
  | "withdraw"
  | "limits"
  | "trust"
  | "start"
  | "cost"
  | "room"
  | "other";

export const PRODUCT_INTENTS: readonly ProductIntent[] = [
  "how-it-works",
  "autonomy",
  "deposit",
  "withdraw",
  "limits",
  "trust",
  "start",
  "cost",
  "room",
  "other",
];

/**
 * The question shapes that route a message to the fact base.
 *
 * `trust` is deliberately absent, for the same reason `drafts.ts` gives where it uses this
 * list: "real" and "legit" are ordinary words in a trading room, and a trust question is
 * only answered as one once `asksAboutProduct` has already found a trust word. Every shape
 * here is a question about the platform with a reviewed answer, so a message that matches
 * one is answered rather than deflected.
 */
export const PLATFORM_INTENTS: ReadonlySet<ProductIntent> = new Set<ProductIntent>([
  "how-it-works",
  "autonomy",
  "deposit",
  "withdraw",
  "limits",
  "start",
  "cost",
  "room",
]);

export interface KnowledgeEntry {
  id: ProductIntent;
  /** the question, in a few words, for the prompt and the turn's audit note */
  label: string;
  /**
   * The accurate description of the platform, as sentences.
   *
   * This is the ground truth handed to the Voice on a product turn and the source every
   * line below is written from. Nothing about the platform may be stated that is not here.
   */
  facts: string[];
  /**
   * Lines in named members' own words, for the questions a newcomer actually asks.
   *
   * Offered ahead of the shared pools, so the answer to "how does it work" sounds like the
   * person giving it. They are written at the register they are used in: most are whole
   * thoughts, so they answer a normal or a full turn, and the shared pools answer the short
   * and beat tiers where a whole thought cannot fit.
   *
   * `other` is the exception, and holds two registers per member on purpose. It is the one
   * question with no facts behind it — the honest answer is "ask support" — so the voice is
   * the entire answer, and a member who only had a one-liner would hand a full turn back to
   * the shared pool in a name. Measured before the split: asked the same gap question 132
   * times across the roster, the room produced **6** distinct lines.
   */
  personal?: Partial<Record<PersonaId, string[]>>;
  /** Reactions, for the beat tier only. A beat must still be an answer. */
  beat: string[];
  /** One-liners, the length of a text sent while doing something else. */
  short: string[];
  /** Whole thoughts, used for the normal and full tiers and joined when a longer turn needs it. */
  thought: string[];
}

/**
 * The platform, as the room knows it.
 *
 * Every line in the pools below is written from these facts, and the whole section is
 * reviewed as a unit: the facts are what a model is handed, the pools are what a reader
 * sees when no model answers, and the two saying the same thing in two registers is the
 * point.
 */
const HOW_IT_WORKS_FACTS = [
  "You fund your Axion account, then you choose how much of that balance to release to AxAI.",
  "Whatever you release, AxAI trades by itself. You do not place those trades.",
  "You set two numbers before it runs: a loss limit, the most you are willing to lose, and a profit goal, the percentage you want it to stop at.",
  "When either number is hit it stops, and the rest of your balance just sits there.",
  "The part of the balance you do not release is not traded.",
  "You can change the allocation or the two numbers, or take the money back out of AxAI.",
];

export const KNOWLEDGE: Record<ProductIntent, KnowledgeEntry> = {
  "how-it-works": {
    id: "how-it-works",
    label: "how the trading works",
    facts: HOW_IT_WORKS_FACTS,
    // Three lines each, and the first is a one-liner: this is the question that is asked most, at
    // every length, so a member needs something of their own that fits a quick turn as well as a
    // whole thought. Every line uses the word the question uses — "trading"/"works" — because
    // that is the token the Gate's ADDRESSEE rule and this bank's own audit measure "it answers"
    // with, and the shared pools do not carry the members' voices.
    personal: {
      mara: [
        "the trading is on the part you release, you set the two numbers 😅",
        "you put money in, you decide how much of it goes to the AI, then you set your loss limit and your profit goal and the trading runs inside those. i was skeptical too 😤",
        "the part nobody tells you is that you pick the two numbers, not the entries. loss limit on one side, profit goal on the other, and it works between them",
      ],
      dmitri: [
        "the trading works inside your loss limit and profit goal",
        "the trading works inside two numbers you fix: the loss limit and the profit goal. you fund the account and release a share of it to AxAI, and the engine stops at either edge",
        "the mechanism is unremarkable. your balance, a portion released to the engine, a loss limit and a profit goal it is not allowed to cross",
      ],
      sol: [
        "the trading is all axai lol, you just set two numbers",
        "you put money in, you hand part of it to axai, you set a loss limit and a profit goal and the trading happens without you. then you sit on your hands which is the hard part lol",
        "deposit, release a chunk to the ai, set your two numbers. that is genuinely the whole setup, i did mine on my phone",
      ],
      toko: [
        "trading runs between your two numbers. no entries",
        "fund it, release part to the ai, set your stop number and your target number. the trading runs between them and there are no entries to babysit",
        "two numbers. loss limit and profit goal. everything between those is the engine's job, not yours",
      ],
      priya: [
        "the trading works on the portion you release, not your whole balance",
        "it is funded balance, an allocation you release to AxAI, then a loss limit and a profit goal. the trading is on that allocation and it stops at whichever number you set",
        "the useful part is that the two constraints are yours. you are not agreeing to someone else's risk, you are setting the floor and the ceiling",
      ],
      kofi: [
        "the trading is the ai's part, you set the two numbers",
        "money in, part of it to the ai, loss limit and a profit goal. the trading is the ai's part and i just watch it",
        "you set the two numbers and it trades inside them. guessing the entries is the part you give up",
      ],
      lena: [
        "the trading works on the portion you release, inside your two numbers",
        "you fund the account, you release some of it to AxAI, you set a loss limit and a profit goal. the trading is on that allocation and it stops when either number is reached",
        "the setup is three decisions: how much goes in, what you are willing to lose, and what you want to stop at. after that the engine is on its own",
      ],
      raul: [
        "the trading is only on the released portion. two numbers decide it",
        "you fund it, you release a portion to the ai, you set a loss limit and a profit goal. the trading stays inside those and the rest of your money sits",
        "simple version: the balance is real, the allocation is what the ai touches, and the loss limit is where it quits",
      ],
      nadia: [
        "the trading works between the loss limit and the profit goal you set",
        "fund the account, release a portion to AxAI, set the loss limit and the profit goal. the trading is on that portion and stops at whichever hits first",
        "the loss limit is the whole design. you are choosing the worst case before it trades, not after",
      ],
      jess: [
        "the trading runs itself, you set the loss limit and the goal",
        "you fund it, release part to the ai, set a loss limit and a profit goal. the trading is the engine's part, that is it",
        "the two numbers are yours. it trades between the loss limit and the profit goal and stops at either end",
      ],
      rafa: [
        "the trading is the released part only, you set the two numbers",
        "fund the balance, release what you want to the ai, set a loss limit and a profit goal. the trading is on the released part only",
        "you keep the unreleased balance. only the part you release gets traded",
      ],
    },
    beat: [
      "money in, then two numbers",
      "you set the numbers here",
      "fund it and set two numbers",
      "it trades what you release",
    ],
    short: [
      "the trading works like this, you fund it and release a portion to the ai",
      "the two numbers you set are the whole thing",
      "you pick the loss limit and the profit goal",
      "the unreleased part of your balance is not traded",
      "it trades between your limit and your goal, that is how it works",
      "you set it up once, mostly from your phone",
    ],
    thought: [
      "the way the trading works: you fund the account, release a portion of it to AxAI, and set two numbers, a loss limit and a profit goal. the engine trades the released portion inside those and stops when either one is hit",
      "the setup is your balance, a portion you release to the ai, then the loss limit and the profit goal it works between. the part of the balance you leave alone is not traded",
      "you do not pick the entries. you fund it, hand a portion over to AxAI, and set the loss limit and the profit goal. it stops at whichever of those two it reaches",
      "the way it works is you fund the account and release some of it to AxAI, which trades on its own between the loss limit and the profit goal you set. you can change the allocation later",
    ],
  },

  autonomy: {
    id: "autonomy",
    label: "whether the AI trades for you and whether you can switch it off",
    facts: [
      "AxAI only trades the portion of the balance you release to it. Nothing else is touched.",
      "It trades by itself from there. You do not have to place or approve trades.",
      "You set the loss limit and the profit goal, so what it may do is bounded by your numbers.",
      "You can change the allocation, change those two numbers, or take the money back out of the AxAI allocation.",
    ],
    personal: {
      nadia: [
        "it only touches the share you release and you place none of it. it cannot trade past your loss limit, which is the only reason i let it run",
        "you can pull the allocation back whenever you want. people assume it is locked and it is only a setting you chose",
      ],
      dmitri: [
        "it trades the released portion and you place none of the orders, it is bounded by your loss limit. you are delegating the entries, not the risk",
        "the allocation is yours to change. i keep mine small because i would rather be the one deciding size",
      ],
      sol: [
        "you choose how much it gets and you place nothing after that, you can take it back whenever lol",
        "it trades by itself with my portion but my loss limit is its leash. i set it low for a reason",
      ],
      mara: [
        "i still do my own trades on the side but the axai portion runs and i place none of it. it stops at whatever loss limit i set, which is why i sleep",
        "you hand it a portion and it trades that.  you can take the portion back if you want it done differently, nothing is locked",
      ],
      kofi: [
        "it does the entries itself and you place nothing, i only set the two numbers. i can pull the whole allocation back",
        "only the share i release gets traded. the rest just sits there and i use it myself",
      ],
      toko: [
        "it trades the released portion by itself and you place nothing. i set the loss limit so it cannot do the thing i would have done",
        "you can turn the allocation off. i keep mine on a small share, the rest i trade myself",
      ],
      rafa: [
        "it runs the released share on its own and you place none of it, your loss limit is the fence. you can pull it back any time",
        "i keep the part i want to trade myself and release the rest to the ai. two books, one of them hands off",
      ],
      lena: [
        "it trades the allocation you release and you place none of it. the loss limit is what limits it, and you can change that allocation whenever",
        "the engine is not running your whole account. it runs the portion you hand over",
      ],
      raul: [
        "it only trades what you release and you place nothing. the rest of the balance is yours and always was",
        "you can pull the allocation whenever you want. it is not a term deposit",
      ],
      priya: [
        "the allocation is the boundary. it trades that portion and you place none of it, and the loss limit bounds the downside",
        "you can turn the AxAI allocation down or off. mine has stayed small and i still trade my own book",
      ],
      jess: [
        "it trades only the part you release and you place none of it. it stops at your loss limit and you can change the allocation any time",
        "you are not approving trades. you set the limits and it runs inside them",
      ],
    },
    beat: [
      "only what you release to it",
      "you can switch it off",
      "it cannot pass your limit",
      "you hand it a share only",
    ],
    short: [
      "it only trades the portion you release",
      "you set the loss limit, so it is fenced in",
      "you can pull the allocation back whenever",
      "you do not place the trades, it just runs",
      "your other balance is not touched at all",
      "you can turn the ai allocation down or off",
    ],
    thought: [
      "it trades only the portion of your balance you release to it, so the rest of your money is never in it. it runs on its own from there inside the loss limit and the profit goal you set",
      "it trades for you and you do not place anything. it can only trade the share you release and it stops at your loss limit, and you can change the allocation or take the money back whenever",
      "the ai trades for you by itself and you do not place the orders, but only with what you hand it and only between the two numbers you set. you can pull that allocation back completely",
      "nothing is locked in. it runs the portion you released, it stops at your loss limit, and the allocation is a setting you can change whenever you want",
    ],
  },

  deposit: {
    id: "deposit",
    label: "how to get money into the account",
    facts: [
      "You add funds to your account from inside the app, on the funding or deposit screen in your account.",
      "Once the money is in the balance, you decide how much of it to release to AxAI.",
      "The funds stay with the platform's custody rather than being sent anywhere by you.",
    ],
    personal: {
      kofi: [
        "you add the money from the account screen, mine is under the balance. then you release a share of it to the ai",
        "deposit is in your account settings, took me a minute to find too. after that you allocate what goes to axai",
      ],
      sol: [
        "you add money from your account screen, i did mine on my phone in like two minutes lol. then you release a portion to the ai",
        "you top the balance up from your account screen and then decide how much the ai gets. the button is in there somewhere, took me a sec too",
      ],
      mara: [
        "it is in your account, the funding bit. then you say how much of the balance goes to AxAI, that part is a slider not a transfer 😅",
        "top the balance up with your own money first, release a portion to the ai after. i did it on my phone so it is not hidden anywhere weird",
      ],
      nadia: [
        "you add funds from the account screen. once it is in the balance you choose the portion that goes to AxAI, which is a separate step",
        "the money goes in from your account, the allocation to the engine is right after that. two steps, not one",
      ],
      toko: [
        "account screen, money in. then release part of the balance to the ai. two taps each",
        "deposit is in your account. after that you set the share the engine gets, it is not the same screen",
      ],
      jess: [
        "it's under your account, the funding bit. then you release part of it to the ai from the same place",
        "you top the balance up with money first, the axai allocation is a second step",
      ],
      lena: [
        "the funding screen is in your account and the allocation to AxAI is right after it. the balance stays in the account, you are not transferring anywhere",
        "the money goes in from your account screen, then you choose how much of the balance is released to the engine",
      ],
      dmitri: [
        "funding is in your account screen. releasing the portion to the engine is the step after",
        "you add the money, then you allocate. the two are separate deliberately",
      ],
      raul: [
        "it's in your account. money in first, then you release a portion to the ai",
        "put the money in from the account screen, the allocation is a separate setting",
      ],
      rafa: [
        "your money goes in from the account screen, then you release a portion to the ai",
        "you add it from the account screen. the balance sits there until you allocate some to the engine",
      ],
      priya: [
        "the deposit screen is in your account. once the money is in the balance you release a portion to AxAI from the allocation setting",
        "you deposit into the account first, the engine's allocation is a separate control after that",
      ],
    },
    beat: [
      "it's in your account",
      "funding is in your account",
      "top up the balance first",
      "then release part of it",
    ],
    short: [
      "it is in your account, the funding screen",
      "add it to the balance first, then allocate",
      "you top up from the account screen",
      "took me a minute to find too, it is in there",
      "the balance stays in your account, you are not sending it anywhere",
    ],
    thought: [
      "you add funds from the funding screen in your account. it stays in the balance after that, and releasing a portion of it to AxAI is a separate step from the same area",
      "it is in your account under the funding or deposit option. once it is in the balance you decide how much of it the engine gets, which is a different setting",
      "the money goes into your account balance and sits there. you only release a portion to the ai afterwards, so you can see it land before any of it is traded",
    ],
  },

  withdraw: {
    id: "withdraw",
    label: "how to take money out",
    facts: [
      "You take money out from the same account screen you funded it from.",
      "Money currently released to the AxAI allocation has to be brought back into your balance first.",
      "The room does not know the exact processing times or limits, so nobody states one.",
    ],
    personal: {
      mara: [
        "the withdrawal is in your account, same place you put the money in. i pull mine back off the ai allocation first 😅",
        "you take it out from the account screen, you know the one you funded from. the bit in the ai has to come back into your balance first",
      ],
      jess: [
        "the withdrawal is on the same screen you funded from. bring it back off the ai allocation first or it isn't in your balance to take",
        "it's in your account with the deposit. off the ai first, then out",
      ],
      dmitri: [
        "the withdrawal option is on the account screen, and anything released to the engine has to come back into the balance first. that second part is what catches people",
        "the option sits with the funding, in your account. i move the allocation back into the balance before withdrawing from it",
      ],
      sol: [
        "the withdrawal is in your account, same place as funding lol. i move mine off the ai allocation first then pull it",
        "same screen as the deposit. take it out of the ai first or it's still the engine's to trade",
      ],
      toko: [
        "withdrawal is on the account screen. back off the ai first then out",
        "same place as funding. allocation off, then withdraw",
      ],
      priya: [
        "the withdrawal option is in your account with the funding, and i recall the allocation first so the balance is whole. i do not know their processing times, i never timed mine",
        "it is the same area as the deposit. anything still released to the engine is not withdrawable until it is back in your balance",
      ],
      kofi: [
        "the withdrawal is on the account screen, same as funding. off the ai allocation first",
        "it's in your account. bring the allocation back in first, then take it",
      ],
      lena: [
        "the withdrawal is in your account, same area as the funding. take the portion back out of the AxAI allocation and it comes out of the balance",
        "the option is with the funding in your account. i do nothing else first except pull the allocation back into the balance",
      ],
      raul: [
        "the withdrawal is in the same place you funded it. the part sitting in the ai has to come back first",
        "it's in your account. allocation back into the balance, then out",
      ],
      rafa: [
        "the withdrawal is on the account screen. pull it off the ai allocation first and then it's yours",
        "same screen as the deposit. the allocation has to be back in your balance before you can take it",
      ],
      nadia: [
        "the withdrawal is on your account screen. bring the allocation back into the balance first, then take it out",
        "it is on the same screen as the funding. nothing in the engine allocation is withdrawable until you release it back into your balance",
      ],
    },
    beat: [
      "from the same account screen",
      "pull it off the ai first",
      "the screen you funded from",
      "off the ai then out",
      "same place as the deposit",
    ],
    short: [
      "it is on the same account screen as funding",
      "i move it back off the ai allocation first",
      "mine went through, i never counted the days",
      "your account has the withdrawal option in it",
      "take it back off the ai allocation first",
      "it is the same place you funded from",
      "i do not know their processing times, i only know the button",
    ],
    thought: [
      "you take it out from the account screen, the same place you funded it. i bring my part back off the AxAI allocation first and then withdraw from the balance, but i cannot remember the exact processing time",
      "it is in your account, same area as the funding. anything sitting in the engine allocation has to come back into the balance before you pull it out, at least that is how mine worked",
      "i have done it from my phone, the option is in the account section. i honestly do not remember how long mine took, if that matters ask support rather than me",
      "the withdrawal is in your account with the funding, and the only thing in front of it is the allocation. anything you released to AxAI has to come back into the balance, and then it is just a withdrawal like any other",
      "you find it in your account rather than anywhere else, same place as the deposit. i do not know the limits or the timetable on it, that is a support question, but pulling the allocation back in is the part people miss",
    ],
  },

  limits: {
    id: "limits",
    label: "the loss limit and the profit goal",
    facts: [
      "The loss limit is the most you are willing to lose. When it is reached, the engine stops.",
      "The profit goal is a percentage. When the account reaches it, the engine stops there too.",
      "You can lose money on it. That is what the loss limit is for: it is the worst case you agreed to in advance.",
      "Both numbers are set by you and can be changed whenever you want.",
      "The loss limit is the whole guardrail: the engine is not allowed to trade past it.",
    ],
    personal: {
      nadia: [
        "the loss limit is the most you are willing to lose and the profit goal is the number you want to stop at. you set both and change them whenever. that is the entire risk control and it is enough",
        "if there is one thing to get right it is the loss limit. set it where you can still think clearly, not where you feel brave",
      ],
      mara: [
        "you set a loss limit and a profit goal and the engine stops at either one. the loss limit is the bit that keeps me honest 😅",
        "the profit goal is a percentage you pick. the loss limit is the other side of it. both are changeable, i move mine around",
      ],
      dmitri: [
        "the loss limit is a hard stop and the profit goal is a percentage target. both are yours to set and change. it will not trade through the loss limit",
        "the two numbers are the entire risk framework. loss limit on one side, profit goal on the other, and the engine works between them",
      ],
      sol: [
        "you set a loss limit and a profit goal and it stops at whichever comes first. mine is set low because i have seen what i do without one 🫡",
        "profit goal is a percent, loss limit is a number you are okay losing. it stops at either. i change mine about once a month",
      ],
      toko: [
        "loss limit and profit goal, both yours, both changeable. it stops when either is hit",
        "the loss limit is the only number that matters. the profit goal you can move, the loss limit you leave alone",
      ],
      priya: [
        "the loss limit is your floor and the profit goal is where you stop. both are set by you and can be changed, and the engine stops at whichever is reached",
        "i treat the loss limit as the invalidation and the profit goal as the target. it is the same discipline i would use manually, just enforced by the engine",
      ],
      jess: [
        "loss limit is the most you lose, profit goal is a percentage it stops at. both are yours, change them whenever",
        "you set two numbers and it stops at either. the loss limit is the one i would think hardest about",
      ],
      kofi: [
        "loss limit and profit goal. you set both, it stops at which one hits first",
        "the loss limit is the stop, the profit goal is the target. both are in your settings and changeable",
      ],
      lena: [
        "the loss limit caps what the engine can lose and the profit goal is the percentage it stops at. you set both and you can revise them whenever",
        "i set a loss limit i am comfortable with first, then the profit goal. the engine works between the two",
      ],
      raul: [
        "loss limit and a profit goal, both set by you, both changeable. it stops at whichever one it reaches",
        "the loss limit is the part that matters. the profit goal is just where you would rather stop",
      ],
      rafa: [
        "you set a loss limit and a profit goal. it stops at either one and you can move both",
        "the loss limit is where it quits, the profit goal is where it takes the win. your numbers, always",
      ],
    },
    beat: [
      "loss limit and profit goal",
      "it stops at your loss limit",
      "both numbers are yours",
      "profit goal is a percentage",
    ],
    short: [
      "you set a loss limit and a profit goal",
      "it stops at whichever number is hit first",
      "both are yours to change whenever",
      "the loss limit is the part that matters",
      "the profit goal is a percentage you choose",
      "it is not allowed to trade past your loss limit",
    ],
    thought: [
      "you set two numbers, and they are both yours. the loss limit is the most you are willing to lose and the profit goal is a percentage the engine stops at, and it quits at whichever one it reaches first",
      "the loss limit is the guardrail. reach it and the engine stops there, and if the account gets to the profit goal you set it stops there too. you can move either number whenever you want",
      "the profitable side is a percentage target you choose and the other side is a loss limit you choose. it works between those two and it is not allowed to trade through the loss limit",
      "you decide the worst case before it starts. the loss limit is that number, the profit goal is the percentage you want to stop at, and it stops at whichever is hit",
    ],
  },

  trust: {
    id: "trust",
    label: "whether it is real and whether the money is safe",
    facts: [
      "Axion is a real platform and AxAI is the part of it that trades. The money is your own account balance.",
      "The engine trades only the portion you release to it, inside the loss limit and the profit goal you set.",
      "There is no promise in any of it. The loss limit is how you decide your worst case, and nobody in the room gives advice or tells anyone what to do with their money.",
    ],
    // Same two-register rule as `room`: a one-liner and a whole thought, and every line uses
    // the words a person actually asks this with — real, money, lose — rather than the words
    // the facts are written in. The measured gap this closes: asked "am i gonna lose
    // everything", 7% of answers were a member's own, because the shared pool said "real"
    // where the member's own lines said "something i cannot answer".
    personal: {
      mara: [
        "it's real and you can lose on it, i've been trading my own stuff on it two years 😅",
        "it's a real platform, i use it every day. how your money will do on it is not something i can answer, and i would be careful with anyone in here who says otherwise. the loss limit is the part you actually control",
      ],
      jess: [
        "it's real, and no one here can tell you what you lose or make on it",
        "it's a real app, i have traded on it for a while. what your money does on it is not something i can answer for you, and i would not trust anyone in here who says they can",
      ],
      dmitri: [
        "it is a real platform and you can lose on it. your money is your own account",
        "it is a real platform and the balance is your own account rather than ours. whether your money works out on it is not something anyone in here can answer, myself included. you can lose on it, which is what the loss limit is for",
      ],
      sol: [
        "it's real lol, and you can lose on it. not answering for your money",
        "it's a real app, i've been on it ages. whether you make money on it is a different question and i'm not answering that one for you, and nobody in here should be either honestly",
      ],
      toko: [
        "real app. you can lose on it, that is what the limit is for",
        "it's a real platform. you can lose money on it, so set the limit where you can live with it and treat the rest as unknown. nobody can call your outcome for you",
      ],
      priya: [
        "the platform is real and you can lose on it, i have used it for years",
        "the platform is real and the money is your own account. how your money will do on it is not something i can answer, and i would be careful with anyone in here who claims they can",
      ],
      kofi: [
        "it's real. you can lose on it and nobody here can tell you what your money does",
        "real platform. the money sits in your own account, the engine only trades what you release, and you can lose on it. the loss limit is what you set. that's all anyone here knows",
      ],
      lena: [
        "it is a real app and you can lose on it, i have been on it a couple of years",
        "it is a real app and the money is your own account. the engine stops at your loss limit, so you can lose on it and that is the number worth setting. how yours goes is up to your two numbers",
      ],
      raul: [
        "real platform, real account. you can lose on it, nobody promises anything",
        "it's real. whether it makes you money is not a thing anyone can say, so i won't. the loss limit is the only part of it you actually control",
      ],
      rafa: [
        "it's real, i trade on it. you can lose on it, and your money is your own call",
        "it's real, i trade on it every day and i still do not know how your money goes on it. the loss limit is the number that matters and nobody in here can promise you the other side",
      ],
      nadia: [
        "it is a real platform. you can lose money on it",
        "it is a real platform and you can lose money on it, which is what the loss limit is for. nobody here should promise you the other side, and i will not",
      ],
    },
    beat: [
      "real app, your own account",
      "nothing promised, set limits",
      "you can lose on it",
      "only what you release trades",
      "real platform, my balance",
      "no promises, just limits",
    ],
    short: [
      "it is real, i have been on it two years",
      "you can lose on it, that is what the limit is for",
      "nothing is promised, that is what the limit is for",
      "i cannot promise you anything about your money",
      "the engine only touches what you release to it",
      "it is a real app and the balance is yours",
      "i trade on it, i cannot promise you how yours goes",
    ],
    thought: [
      "the honest answer is you can lose money on it, and the loss limit is the number you pick so that losing is survivable. that is the whole of it",
      "it is a real app and i have used it for two years, but nobody here can promise you anything about your own money. the balance is your account and the loss limit is how you decide the worst case",
      "the money sits in your own account and only the portion you release to AxAI ever gets traded, inside the limits you set. i am not going to tell you what to do with yours",
      "i can tell you what it does, which is trade the part you release inside your loss limit and profit goal. whether the money works out is not something i can answer for anyone, and i would not trust a person who said they could",
      "nobody in here can promise you anything about the money, and the app is a tool rather than a promise. the rest of my account is untouched and the engine stops at my loss limit, which is the only reason i am comfortable with it",
    ],
  },

  start: {
    id: "start",
    label: "how to get started and whether you need to know trading",
    facts: [
      "You fund the account, release a portion to AxAI, and set a loss limit and a profit goal. That is the whole setup.",
      "You do not have to know how to trade. Picking the two numbers is the part that is yours.",
      "The room does not know the platform's minimum deposit, so nobody states one.",
    ],
    personal: {
      mara: [
        "you start by funding it, then send a bit to the ai and set your loss limit, and off it goes 😅 you don't need to know how to trade",
        "the start is five minutes on your phone and i am not technical at all. the number worth thinking about is the loss limit, not the entries",
      ],
      jess: [
        "you start by funding it and setting your two numbers. that's the whole setup",
        "nothing to learn before you start. the loss limit is the bit you actually have to pick",
      ],
      dmitri: [
        "you start by funding the account, allocating to the engine and setting a loss limit and a profit goal. no trading knowledge is required",
        "the start is three decisions and none of them is an entry. how much you fund, how much you release, and where your loss limit sits",
      ],
      sol: [
        "you literally start by funding it and setting two numbers lol. i did mine on my phone at like 2am",
        "you don't need to know charts to start, i promise. fund it, allocate a bit, set your numbers",
      ],
      toko: [
        "fund, allocate, two numbers. that is the start",
        "no chart knowledge needed at the start. the two numbers are the whole setup",
      ],
      priya: [
        "you start by funding it, allocating a portion to the engine, and setting the two numbers. i would start with a loss limit you can live with",
        "the start is three decisions and none of them requires knowing how to trade. how much goes in, how much it gets, and where you stop",
      ],
      kofi: [
        "you start by funding it and setting the numbers. you don't need to know charts",
        "took me an evening. start with funding, then allocate, then the loss limit and your goal",
      ],
      lena: [
        "the start took me an evening. fund the account, release a portion, set a loss limit and a profit goal",
        "you do not have to know how to trade to start. the two numbers are yours and that is where the thinking goes",
      ],
      raul: [
        "start by funding it, release a portion, set the numbers. takes an evening",
        "no trading knowledge required to start. pick the loss limit carefully, that is the only real decision",
      ],
      rafa: [
        "you start with the two numbers. fund it and set them, no charts needed",
        "start with an evening to set it up, and most of that was me deciding the loss limit",
      ],
      nadia: [
        "start with the loss limit and set it first. the rest of the setup follows from that number",
        "no trading knowledge needed to start, but pick the loss limit like it matters, because it is the one that does",
      ],
    },
    beat: [
      "fund it, then two numbers",
      "no trading knowledge needed",
      "three steps, that is all",
      "an evening on your phone",
      "start with the loss limit",
    ],
    short: [
      "you start by funding it and setting the two numbers",
      "took me an evening to set up",
      "you do not have to know how to trade",
      "start with the loss limit you can live with",
      "i do not know the minimum, mine was already there",
      "no chart reading required for the setup",
      "pick the loss limit first, everything else follows",
    ],
    thought: [
      "you start by funding the account, then release a portion to AxAI, then set a loss limit and a profit goal. that is the whole thing, and it took me an evening on my phone",
      "you do not need to know how to trade for this to work. the number that actually matters is the loss limit, and that one is yours to pick",
      "fund it, allocate a portion to the engine, set the two numbers. i do not know what the platform's minimum is, i never hit it",
      "there is nothing to learn before you start. you fund the account, decide how much of it the engine gets, and set the loss limit and the profit goal it works between",
      "if you are new, the two numbers are where i would spend the time. the funding and the allocation are just buttons in your account",
    ],
  },

  cost: {
    id: "cost",
    label: "what it costs",
    facts: [
      "There is a paid plan for the platform. The room does not have the current price in front of it.",
      "Each member knows which plan they are on and that they renew it, and that is all they state.",
    ],
    personal: {
      mara: [
        "i pay for the smaller plan, i honestly don't look at the cost anymore 😅 it's in your account",
        "there's a plan and i'm on the cheap one. i stopped looking at the cost a year ago, so check yours",
      ],
      jess: [
        "there's a plan. i pay it and forget it, the cost is in your account",
        "i'm on a paid plan. i don't know the current cost, ask support for a number",
      ],
      dmitri: [
        "there is a plan and i am on the cheaper tier. the cost is in your account, i do not keep it in my head",
        "it is a paid platform. i renew mine and never look at the cost, so your account will tell you better than i can",
      ],
      sol: [
        "i'm on the small plan lol, i do not know the cost",
        "there's a plan, i pay it. the cost is somewhere in your account 😭",
      ],
      toko: [
        "small plan. the cost is in the app",
        "i pay for the cheap tier. the cost is in your account",
      ],
      priya: [
        "i am on the smaller plan. i could not quote you the cost, check your account",
        "there is a paid plan for it and i am on the lower tier. i would check your account for the cost rather than take mine",
      ],
      kofi: [
        "i pay for the cheap one. the cost is in there somewhere",
        "there's a plan, i'm on it. i don't remember the cost",
      ],
      lena: [
        "there is a plan and i renew without reading it. the cost lives in your account",
        "it is a paid platform. i pay for the smaller plan and have never gone looking for the exact cost",
      ],
      raul: [
        "i pay the plan. the cost is in your account, i never look",
        "there's a subscription. i'm on it and i don't watch the cost",
      ],
      rafa: [
        "i'm on a plan, i forget the cost. it's in your account",
        "there's a monthly thing and i pay it. ask support for the current cost",
      ],
      nadia: [
        "i pay for it. the cost is in your account, check yours rather than mine",
        "there is a plan and i am on the smaller one. i do not recommend trusting my memory for the cost",
      ],
    },
    beat: [
      "there's a plan, i renew mine",
      "i pay for the smaller plan",
      "the price is in the app",
      "it's a paid plan",
      "your account has the tiers",
    ],
    short: [
      "there is a plan and i pay for the smaller one",
      "i renew mine without thinking about the cost",
      "the price is in your account, i forget the number",
      "i have paid for it for two years, that is all i know about the cost",
      "it is a paid platform, the tiers are in your account",
      "i could not quote you the cost, it is in your account",
    ],
    thought: [
      "there is a plan and i pay for the smaller one, i have renewed it twice without thinking about it. the actual price i would have to look up in my account",
      "i honestly do not keep the number in my head, i just pay it. the plan details are in your account, mine are somewhere in there",
      "i am on the smaller plan and i have never looked at the current price since i signed up. ask support if you want a straight answer on the cost",
      "it is a paid platform rather than a free one, and that is about all i know about the pricing. i picked the smaller plan and stopped thinking about it, and your account will show you the tiers",
      "i can tell you i pay for it and that it renews. what i cannot do is give you the current price, because i have not looked at mine in a year, so check your account or ask support",
    ],
  },

  room: {
    id: "room",
    label: "what this room is",
    facts: [
      "This is the community room on the Axion app: the people who trade on it, talking to each other.",
      "It is the app's own room, not a separate group someone runs on the side.",
    ],
    // Written twice over for the reason `KnowledgeEntry.personal` describes: this is the one
    // question where a newcomer can see the whole room at once, and the shared pools answer
    // it in four lines. The first line is a one-liner and the second is the whole thought, so
    // a member has something of their own to say at every length the room runs at.
    personal: {
      mara: [
        "the room that comes with the app, that is what this place is 😄",
        "this place is the app's own room, nobody runs it and nobody invited us, we just all ended up in it the same way you did 😄 it ships with the platform, so it is the same faces most days",
      ],
      jess: [
        "it's the app's own room, this place comes with it",
        "it's the app's chat, this place comes with the platform rather than being somebody's group on the side. no one runs it, we just all end up in here when we are on the app",
      ],
      dmitri: [
        "this place is the app's own room, nobody set it up on the side",
        "this place is the platform's own room rather than a group somebody runs. it is the people who trade on the app talking to each other, and it is the same room every day",
      ],
      sol: [
        "bro this is just the app's chat, we all ended up here",
        "this place is the app's own chat, nobody made a group or invited me or anything, we all ended up here the same way 😭 it comes with the platform so it is the same people every day",
      ],
      toko: [
        "app's room. this place comes with it",
        "this place is the app's room rather than somebody's group. same faces, same three markets, every session, and nobody here is running anything. that is the whole of it",
      ],
      priya: [
        "the room that comes with the platform, eleven of us most days",
        "this place is the app's own room rather than something one of us runs. the same people trade and talk in it, and it comes with the platform, so you are in the right place",
      ],
      kofi: [
        "the app room, we're all on here",
        "this place comes with the app so there's no group to join, we're all just on it at the same time and honestly nobody runs anything, it's just",
      ],
      lena: [
        "the app's own room, the people who trade on it",
        "this place is the app's own room, the same people who trade on it talking to each other. it comes with the platform, nobody runs it as their own thing",
      ],
      raul: [
        "the app's room. that is all this place is",
        "this place is the platform's own room rather than a group on the side. same people, same arguments, every day, and nobody is hosting anything. that is the whole of it",
      ],
      rafa: [
        "the app's room, we just all show up here",
        "this place is the room that ships with the app, same faces most days, nobody running it and nobody picked who is in here. you found it the same way the rest of us did",
      ],
      nadia: [
        "the platform's room, that is all it is",
        "this place is the platform's own room. nobody here is hosting anything and nobody selected us, it is the people trading on the app at whatever hour. that is the whole of it",
      ],
    },
    beat: [
      "it is the app's own room",
      "the room on the axion app",
      "we are on here every day",
      "it ships with the app",
      "no one runs it, we just talk",
    ],
    short: [
      "it is the room that comes with the app",
      "the place where the people on axion talk",
      "it is the app's own room, not a group someone runs",
      "we are all on here most days",
      "nobody runs it, we all just show up",
      "it comes with the platform, same faces most days",
    ],
    thought: [
      "it is the room that comes with the app, the place where the people who trade on axion talk to each other. nobody runs it on the side, it is just where everyone ends up",
      "yeah it is the platform's own room. this is the place eleven of us end up most days, arguing about the same three markets",
      "this is the community part of the app. you are in the right place, it is the same room everyone uses",
      "the room comes with the platform rather than being somebody's private chat, so it is just the people using the app at whatever hour they happen to be awake",
      "nobody set this up as a project. it is the app's own room, and the same handful of us are in it every day talking about the same markets",
    ],
  },

  other: {
    id: "other",
    label: "a question about the platform the room cannot answer accurately",
    facts: [
      "The room's product facts are limited to how the trading works, funding, the loss limit and the profit goal, and what it costs.",
      "Anything outside that is a genuine gap, and the honest answer is that the person should ask the platform's own support rather than a trader in the room.",
    ],
    personal: {
      mara: [
        "that is a support question, i honestly do not know 😅",
        "i do not know that side of the platform and i am not going to invent an answer for you 😅 support in the app can actually see your account, so ask them and skip the guesses from the rest of us",
      ],
      jess: [
        "no answer for that one here, ask support in the app",
        "i have not had to do that so i am not going to guess, and a quick answer from me about your account would be exactly that. support in the app is who i would ask, they can see it",
      ],
      dmitri: [
        "not a platform question i can answer. support can",
        "that is outside the platform facts i keep. i do not answer questions about somebody's account, and neither should anyone in here who cannot see it. support in the app can look at it and give you a straight answer",
      ],
      sol: [
        "no clue on that one bro, support would answer it",
        "bro i genuinely do not know that side of it, i only know where the buttons are for trading lol. support in the app will actually answer it instead of guessing like the rest of us would",
      ],
      toko: [
        "not my question to answer. support in the app",
        "not a trading question so not mine. i do not answer what i cannot see. support in the app sees your account, one message instead of five guesses from here",
      ],
      priya: [
        "i do not have the answer to that one, tbh",
        "i do not have that answer and i will not guess at your account tbh, that is exactly the kind of thing support in the app can check properly. i have gone to them twice and both times it was the right call",
      ],
      kofi: [
        "that one is not mine to answer, support would",
        "i only trade on it so i do not have an answer for the account side, and honestly nobody in this room does. support in the app can look, they see what i cannot",
      ],
      lena: [
        "i do not have an answer for that, ask support",
        "that is not an answer i have, tbh. i know the trading side of the platform and the account side is genuinely somebody else's. support in the app can look at it properly, which beats a guess from me",
      ],
      raul: [
        "not a platform question for me. support answers those",
        "not a platform question i can answer. i trade, support handles the account side, and a guess from a desk in here helps nobody. ask them and you get the real answer in one go",
      ],
      rafa: [
        "that is a question for support, i only trade on it",
        "i only trade on it, so a question about the account side is not mine to answer. support in the app can actually look at yours, i would go there before you take a trader's word",
      ],
      nadia: [
        "no answer from me. support can see your account",
        "no answer from me on that one and i will not dress a guess up as one. support can see your account, which is the whole point of asking them. a desk in here can only tell you what it trades",
      ],
    },
    beat: [
      "the app's support would know",
      "i only trade on it, not that",
      "ask support on that one",
      "that one's for support",
      "not my side of it",
    ],
    short: [
      "that is a support question, i only trade on it",
      "i do not know that side of it, i just use it",
      "support in the app would give you a straight answer",
      "i have never needed that, so i would ask them",
      "i only trade on it, so that one is not mine",
      "that is past me, support can see your account",
    ],
    thought: [
      "i only trade on it, so that side i do not know. the support channel in the app is where i would ask, they can actually check your account",
      "i have never had to deal with that, so take mine as nothing. support in the app is the ones who know, i would go there rather than trust a trader in here",
      "that is past what i know about the platform. i do not want to guess about your account, so support is the honest answer",
      "i would rather tell you i do not know than make something up about your account. the support channel in the app can look at it, i cannot",
      "nobody in here can see your account, which is why i would ask support for that one. i only know how the trading side of it works",
    ],
  },
};

/** One line the model may state, and the question it answers. */
export const KNOWLEDGE_FACT_SHEET: readonly string[] = [
  ...HOW_IT_WORKS_FACTS,
  "The profit goal is a percentage set by the member. Both it and the loss limit can be changed at any time.",
  "Only the portion of the balance released to AxAI is traded. The rest of the balance sits in the account.",
  "Funding, the AxAI allocation and withdrawals all live in the member's own account on the platform.",
  "There is a paid plan for the platform. The room does not know the current price or the processing times.",
  "Nothing about the platform's performance, its fill quality, its fees or its speed is known to the room, so nobody states any of it.",
];

/**
 * How a message is classified into a question shape.
 *
 * Ordered, first match wins, and deliberately specific at the top: "money" alone appears in
 * a funding question, a withdrawal question and a trust question, so the bare nouns are
 * only consulted once the narrower shapes have had their turn. The patterns are on the
 * message's words, not on a model's read of them, because a replay has to route the same
 * message to the same answer.
 */
const INTENT_PATTERNS: ReadonlyArray<readonly [ProductIntent, RegExp]> = [
  // Before funding: "money out" is not "money in".
  [
    "withdraw",
    /\b(?:withdraw\w*|cash ?out|cash ?it ?out|take (?:my |the |it )?(?:money|funds|cash) out|pull (?:my |the )?(?:money|funds|cash|it) out|payout|paid out|payouts)\b/i,
  ],
  [
    "deposit",
    /\b(?:deposit\w*|fund(?:ing|s)?|top ?up|top it up|add (?:some |more |my |the )?(?:money|funds|cash|credit)|(?:put|get|send|move|transfer|pay) (?:some |more |my |the )?(?:money|funds|cash|credit)? ?(?:in|into|onto)|load (?:it|the account) up)\b/i,
  ],
  [
    "limits",
    /\b(?:loss limit|loss ?cap|max(?:imum)? loss|stop ?loss|profit goal|profit target|profit ?%|take profit|guard ?rail|risk limit|drawdown limit|profit percentage|set (?:my |a |the )?(?:limit|goal|target)|how much (?:can|will) it (?:lose|make|stop))\b/i,
  ],
  [
    "autonomy",
    /\b(?:ax ?ai|the ai|automated|autonomous|automatic\w*|by itself|on its own|algorithm|algo|robot\w*|bot|turn (?:it|that) (?:off|on)|switch (?:it|that) (?:off|on)|does it trade|who trades|decide(?:s)? (?:the )?trades|approve (?:the )?trades|hands off|hands-off)\b/i,
  ],
  [
    "how-it-works",
    /\b(?:how (?:does|do) (?:it|this|that|the (?:trading|trade|ai|axai|engine|platform|system|thing|whole thing)) work|how (?:it|this|that|the (?:platform|ai|engine|trading)) works?|how (?:do|does) (?:you|it|they|i) (?:trade|make money|actually trade)|what does (?:it|the platform|axai|the ai) do|how does (?:the )?trading work|does the ai (?:trade|work)|explain how|what happens (?:when|after) (?:i|you) (?:deposit|pay|put))\b/i,
  ],
  [
    "room",
    /\b(?:(?:is|was) this (?:a |the )?[a-z' ]{0,24}(?:chat|room|group)|what is this (?:place|thing)|what'?s this (?:place|thing)|who (?:are|r) (?:you|you all|everyone|u all)|are you (?:all )?(?:real )?(?:people|humans))\b/i,
  ],
  // Before `start`, because "i'm new, am i gonna lose everything" is an anxiety about the
  // money rather than a question about the setup, and after `room`, because "is this a real
  // trading room" is asked about the room rather than about the money.
  [
    "trust",
    /\b(?:real|really|legit|legitimate|scam|fake|safe|safety|trust|trustworthy|genuine|honest|guarantee\w*|reliable|worth (?:it|doing)|should i (?:trust|use|deposit)|will i lose|am i (?:gonna|going to) lose|lose (?:my|it all|everything)|losing my money|risky)\b/i,
  ],
  [
    "start",
    /\b(?:how (?:do|can) i (?:start|begin|sign ?up|get started)|get(?:ting)? started|i'?m new|im new|new here|just (?:joined|signed up|started)|beginner|no idea what i'?m doing|minimum|min(?:imum)? deposit|how much (?:do i need|to start|should i (?:put|start))|first time|do i need to know)\b/i,
  ],
  [
    "cost",
    /\b(?:fee|fees|cost|costs|pricing|subscription|subs|pay(?:ing|ment)?|monthly|per month|how much (?:does|is) (?:it|this)|charges?)\b/i,
  ],
];

/**
 * Which question about the platform this is.
 *
 * Returns `"other"` for a message that is about the platform but does not match a shape the
 * room has facts for — the honest "i only trade on it, ask support" answer, not a guess. The
 * caller has already decided the message is about the platform (`asksAboutProduct`), so an
 * unmatched message here is a gap in the room's knowledge rather than a market question.
 */
export function productIntentOf(text: string): ProductIntent {
  const clean = text.toLowerCase();
  for (const [intent, pattern] of INTENT_PATTERNS) {
    if (pattern.test(clean)) return intent;
  }
  return "other";
}

export function knowledgeFor(intent: ProductIntent): KnowledgeEntry {
  return KNOWLEDGE[intent] ?? KNOWLEDGE.other;
}

/**
 * This member's own lines for this question shape, at every length.
 *
 * `answerCandidates` merges these with the shared pools, and the merge is what the selection
 * needs to undo again: a shared line that happens to contain a word from the question was
 * beating the member's own answer to it, in the member's own name. So the caller that owns
 * the names — `productDraft` — asks for the personal half separately and tells the picker
 * which candidates are the member's.
 */
export function ownLinesFor(intent: ProductIntent, personaId: PersonaId): string[] {
  return [...(knowledgeFor(intent).personal?.[personaId] ?? [])];
}

/**
 * The lines a member may answer this question with, their own first.
 *
 * The personal lines are only offered to the member they belong to, so a terse desk voice
 * never delivers a chatty line that happens to fit and the pools stay the fallback rather
 * than the norm.
 */
export function answerCandidates(
  intent: ProductIntent,
  personaId: PersonaId,
  tier: "beat" | "short" | "normal" | "full",
): string[] {
  const entry = knowledgeFor(intent);
  // A beat is a reaction and its ceiling is under thirty characters, so the personal lines —
  // which are whole thoughts — are never offered for it. They would not fit, and a fallback
  // to `pools.beat[0]` would then hand back a paragraph.
  if (tier === "beat") return [...entry.beat];
  if (tier === "short") return [...(entry.personal?.[personaId] ?? []), ...entry.short];
  return [...(entry.personal?.[personaId] ?? []), ...entry.thought];
}

/**
 * Does the message name a market, even one the room is not currently on?
 *
 * "anyone watching bitcoin tonight" is off the open thread and still market talk: it is
 * answered from the market bank, not from the social one. Without this the room would answer
 * a question about a different market with "no idea honestly", which is both untrue and the
 * deflection the off-topic work exists to remove.
 *
 * It also decides greeting routes, which is why it lives here rather than in `drafts.ts`: a
 * line that names a market is answered as market talk however it opens, so "morning, what's
 * the read on gold" is a market question and not a hello.
 */
export const MARKET_WORDS =
  /\b(?:gold|silver|copper|oil|crude|bitcoin|btc|eth|ethereum|crypto|dollar|euro|pound|cable|yen|rates?|yields?|bonds?|bunds?|semis?|indices|index|sp500|nasdaq|equities|stocks?|shares|earnings|nfp|cpi|macro|chart|charts|levels?|range|breakout|price|tape|flows?|fills?|setup|long|short|stop|entry|target|drawdown|hedge|position|size|vol(?:atility)?)\b/i;

/**
 * Is this message someone arriving rather than asking?
 *
 * A greeting is a social act with a social answer, and the room never gave one: measured over
 * 1,026 published lines, 0 of 6 replies to a visitor greeted them, while greetings were 1.2%
 * of the room's own lines.
 *
 * The live chats then produced the second half of the same failure, which is what the rule
 * below is written against. A visitor sent "Hi", "Hello" and "Hello guys", and each one came
 * back as a market verdict — "not my level.", "you have the causality backwards" — because
 * the room only had one kind of answer. Sending "I'm just greeting, how is everyone doing?"
 * got "that's a nothing level.", and "how is everyone doing?" got "no idea honestly 😅". So
 * the rule covers both ways people arrive: the openers, and the social check-in, which is a
 * question and is still a greeting ("how is everyone" is the room being asked about itself,
 * not about the market).
 *
 * Market talk is excluded first and absolutely: "morning room 🔋 anyone watching gold" is a
 * desk greeting with a market question attached, and the question is what has to be answered.
 */
export function isGreeting(text: string): boolean {
  const clean = text.trim().toLowerCase();
  if (clean.length > 70) return false;
  // A message that names a market is market talk, however it opens. The room answers it from
  // the market bank, and no hello takes that turn over.
  if (MARKET_WORDS.test(clean)) return false;
  // Somebody walking in the door.
  const opens =
    /^(?:hey|hi|hello|yo|sup|hiya|howdy|good (?:morning|evening|afternoon)|morning|evening|afternoon|welcome|new here|just (?:joined|arrived|signed up|saying hi|greeting)|glad to be here|good to be here)\b/;
  // Somebody asking the room about the room: a question, and a greeting all the same.
  const arrival =
    /\b(?:who'?s (?:here|around|up|on)|anyone (?:here|around|up|on)|is anyone (?:here|around|on)|(?:glad|good) to be here)\b/;
  return opens.test(clean) || isCheckIn(clean) || arrival.test(clean);
}

/**
 * Does this read as a question rather than a remark?
 *
 * The classifier's fuzzy shapes need a second test before they may pull a message out of the
 * social bank: `bot` alone puts any line about typing into `autonomy`, so a room where
 * somebody jokes "everyone here types like a bot sometimes" would be answered with how the
 * engine trades. A question word or a question mark is the cheap and honest line — the live
 * failures ("where do i set a loss limit", "does it trade for me or do i place them myself")
 * both carry one, and the social asides that must stay social carry neither.
 */
export function looksLikeQuestion(text: string): boolean {
  return (
    /\?/.test(text) ||
    /\b(?:what|where|when|why|who|whose|which|how|do|does|did|can|could|should|would|will|is|are|am)\b/i.test(
      text,
    )
  );
}

/**
 * The "how is everyone doing" shape, which is a greeting with a question in it.
 *
 * It is separated from the plain hello because it wants a different answer: a person asking
 * the room how it is doing is owed a line about the room, not a welcome — they may have been
 * here all week. The live room answered this shape with a market verdict ("that's a nothing
 * level", "no idea honestly") because its only bank was market talk; `greetingDraft` answers
 * it from `CHECK_IN_LINES` instead.
 */
export function isCheckIn(text: string): boolean {
  const clean = text.trim().toLowerCase();
  if (clean.length > 90) return false;
  return CHECK_IN.test(clean);
}

const CHECK_IN =
  /\b(?:how (?:is|are) (?:everyone|everybody|you all|y'?all|things|it going|the room)|how'?s (?:it going|everyone|everything|things)|how goes it|what'?s up|whats up)\b/;

/**
 * The room's greetings, by member.
 *
 * Written as openers that hand the turn back — a name and a welcome is what a person says to
 * someone who just walked in, and it is the thing the live room never did.
 */
export const GREETINGS: Record<PersonaId, string[]> = {
  mara: ["hey, welcome in 😄", "hey you, good to have you in here"],
  jess: ["hey", "yo, welcome"],
  // No market call in a greeting: a hello someone just walked in with is the one turn where
  // the answer is social. "welcome. rates are the thing to watch here" greeted and pitched in
  // the same breath, which is not what a person says to a stranger at the door.
  dmitri: ["welcome in", "hey, welcome to the room"],
  sol: ["yo welcome to the chaos lol", "hey hey, welcome in"],
  toko: ["welcome in", "yo, welcome. what are you trading?"],
  priya: ["welcome, good to have another one on the desk", "hey, welcome"],
  kofi: ["yo welcome in", "welcome, pull up a chair"],
  lena: ["hey, welcome", "hi, welcome to the room"],
  raul: ["welcome", "hey, welcome in"],
  rafa: ["welcome in", "hey, welcome. ignore half of what we say"],
  nadia: ["welcome", "hey, welcome in"],
};

/**
 * What the room says back to "how is everyone doing".
 *
 * A check-in is not a welcome — the asker is often already in — so it wants a line about how
 * the room actually is, which is what a person answers with. Kept greeting-first so a line can
 * still stand as a reply to a fresh "hey everyone, how's it going".
 */
export const CHECK_IN_LINES: string[] = [
  "hey, slow one here. you?",
  "hi, quiet session. how about you?",
  "yo, we're alright in here. you?",
  "hey, not much happening. how are you?",
  "hi, same as ever. how's your day?",
  "hey, decent. are you new in here?",
  "yo, all good. what are you trading today?",
];

export const GREETING_FALLBACK: readonly string[] = ["hey, welcome in", "welcome in"];

/** The room's greetings as one pool, for a member with no line of their own. */
export function greetingFor(personaId: PersonaId): string[] {
  return GREETINGS[personaId] ?? [...GREETING_FALLBACK];
}
