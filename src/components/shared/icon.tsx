import {
  ArrowDownIcon,
  ArrowLeftRightIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CalendarDaysIcon,
  ChartNoAxesCombinedIcon,
  CheckIcon,
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
  MoreHorizontalIcon,
  PanelLeftCloseIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  TargetIcon,
  UsersIcon,
  WalletCardsIcon,
  XIcon,
  type LucideProps,
} from "lucide-react";

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
