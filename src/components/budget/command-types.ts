import type { Panel, View } from "~/components/budget/types";

export type CommandInput = {
  panel: Panel;
  view: View;
  month: string;
  operationId: string;
  entityId: string;
  data: FormData;
};
