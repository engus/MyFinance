export function DashboardPage({ user }: { user: { id: string; email: string } }) {
  return (
    <div style={{ padding: 32 }}>
      <h1>Добро пожаловать, {user.email}</h1>
      <p>Дашборд появится в следующем под-проекте.</p>
    </div>
  );
}
