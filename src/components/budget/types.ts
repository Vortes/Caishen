import { type RouterOutputs } from "~/trpc/react";

export type State = NonNullable<RouterOutputs["budget"]["state"]>;
export type View = NonNullable<State["view"]>;
