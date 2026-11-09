export const DEMOS: readonly { readonly label: string; readonly message: string }[] = [
  {
    label: "Parallel",
    message:
      "My laptop will not turn on at all, and I would like to know how many days of annual leave I am entitled to.",
  },
  { label: "Dependent", message: "A new colleague starts on Monday and needs equipment." },
  { label: "Restricted", message: "What is the salary band for a senior developer?" },
  { label: "Skill", message: "My VPN is not working." },
];

interface Props {
  readonly disabled: boolean;
  readonly onPick: (message: string) => void;
}

export function DemoButtons({ disabled, onPick }: Props) {
  return (
    <div className="demos" role="group" aria-label="Demo queries">
      {DEMOS.map((d) => (
        <button key={d.label} type="button" disabled={disabled} title={d.message} onClick={() => onPick(d.message)}>
          {d.label}
        </button>
      ))}
    </div>
  );
}
