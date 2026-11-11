import { createContext } from "react";
export const Feedback = createContext<{ text: string; error: boolean }>({
  text: "",
  error: false,
});
