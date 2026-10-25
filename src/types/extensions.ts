/** A user's own reusable instructions, picked in the chat menu or matched by name. */
export interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  created_at: string;
  updated_at: string;
}

export interface SkillInput {
  name: string;
  description: string;
  instructions: string;
}

/** A built-in live tool (stocks, currency, weather, calculator), switched on per account. */
export interface Plugin {
  id: string;
  name: string;
  description: string;
  source: string;
  enabled: boolean;
}
