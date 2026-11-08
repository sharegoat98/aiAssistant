import type { UserInfo } from "./schemas";

interface Props {
  readonly users: readonly UserInfo[];
  readonly userId: string;
  readonly onChange: (userId: string) => void;
}

export function UserSwitcher({ users, userId, onChange }: Props) {
  const current = users.find((u) => u.userId === userId);
  return (
    <div className="user-switcher">
      <label htmlFor="user-select">User</label>
      <select id="user-select" value={userId} onChange={(e) => onChange(e.target.value)}>
        {users.map((u) => (
          <option key={u.userId} value={u.userId}>
            {u.label}
          </option>
        ))}
      </select>
      {current !== undefined && <span className="badge">role: {current.role}</span>}
    </div>
  );
}
