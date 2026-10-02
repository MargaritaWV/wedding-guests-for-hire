export interface ActionState {
  status: "idle" | "success" | "error";
  message: string;
}

export const INITIAL_ACTION_STATE: ActionState = { status: "idle", message: "" };
