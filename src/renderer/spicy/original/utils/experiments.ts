import { $experiment } from "./stores.ts";
export { $experiment };
export const isExperimentEnabled = (name: string): boolean =>
  $experiment.get()[name] === true;
