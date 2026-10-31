/** A user's own reusable instructions: picked in the chat menu, named in a message, or chosen by its description. */
export interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  /** Off: kept, but never used automatically. */
  enabled: boolean;
  /** Slash command that runs it in a message: "meeting-notes" for "/meeting-notes ...". */
  command: string;
  /** GitHub file it was imported from (it can be updated from there), or null. */
  source_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface SkillInput {
  name: string;
  description: string;
  instructions: string;
}

/** A built-in live tool (stocks, currency, weather, calculator, GitHub), switched on per account. */
export interface Plugin {
  id: string;
  name: string;
  description: string;
  source: string;
  enabled: boolean;
}
