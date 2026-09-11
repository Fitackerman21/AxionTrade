import { redirect } from "next/navigation";

/** AxAI merged into the trading terminal — this route now lives at /trade. */
export default function AiRedirect() {
  redirect("/trade");
}
