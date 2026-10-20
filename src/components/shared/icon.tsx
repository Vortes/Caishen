import {
  ArrowDownIcon,
  ArrowLeftRightIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CalendarDaysIcon,
  ChartNoAxesCombinedIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Clock3Icon,
  CopyIcon,
  CreditCardIcon,
  FolderIcon,
  InfoIcon,
  LandmarkIcon,
  MenuIcon,
  MoonIcon,
  MoreHorizontalIcon,
  PanelLeftCloseIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  TargetIcon,
  Trash2Icon,
  UsersIcon,
  WalletCardsIcon,
  XIcon,
  ZapIcon,
  createLucideIcon,
  type IconNode,
  type LucideProps,
} from "lucide-react";

const wallet: IconNode = [
  [
    "rect",
    { x: "3", y: "10", width: "18", height: "11", rx: "2", key: "body" },
  ],
  ["path", { d: "M16 15.5h1", key: "clasp" }],
];
const WalletOutIcon = createLucideIcon("wallet-out", [
  ...wallet,
  ["path", { d: "M12 7V2", key: "stem" }],
  ["path", { d: "m9 5 3-3 3 3", key: "head" }],
]);
const WalletInIcon = createLucideIcon("wallet-in", [
  ...wallet,
  ["path", { d: "M12 2v5", key: "stem" }],
  ["path", { d: "m9 4 3 3 3-3", key: "head" }],
]);

const icons = {
  budget: WalletCardsIcon,
  transactions: ArrowLeftRightIcon,
  shared: UsersIcon,
  loans: ChartNoAxesCombinedIcon,
  settings: SlidersHorizontalIcon,
  plus: PlusIcon,
  arrow: ArrowRightIcon,
  check: CheckIcon,
  posted: CircleCheckIcon,
  chevron: ChevronRightIcon,
  close: XIcon,
  bank: LandmarkIcon,
  card: CreditCardIcon,
  clock: Clock3Icon,
  shield: ShieldCheckIcon,
  search: SearchIcon,
  menu: MenuIcon,
  "chevron-down": ChevronDownIcon,
  "chevron-left": ChevronLeftIcon,
  "chevron-right": ChevronRightIcon,
  target: TargetIcon,
  info: InfoIcon,
  more: MoreHorizontalIcon,
  collapse: PanelLeftCloseIcon,
  calendar: CalendarDaysIcon,
  refresh: RefreshCwIcon,
  folder: FolderIcon,
  copy: CopyIcon,
  "arrow-down": ArrowDownIcon,
  "arrow-up": ArrowUpIcon,
  trash: Trash2Icon,
  "wallet-out": WalletOutIcon,
  "wallet-in": WalletInIcon,
  alert: CircleAlertIcon,
  snoozed: MoonIcon,
  zap: ZapIcon,
};

export type IconName = keyof typeof icons;

export function Icon({
  name,
  size = 20,
  strokeWidth = 1.75,
  ...props
}: { name: IconName } & LucideProps) {
  const Component = icons[name];
  return (
    <Component
      aria-hidden="true"
      size={size}
      strokeWidth={strokeWidth}
      {...props}
    />
  );
}
