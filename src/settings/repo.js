export function createSettingsRepo(db) {
  const getStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  const setStmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );

  return {
    get(key, fallback = null) {
      const row = getStmt.get(key);
      return row ? row.value : fallback;
    },
    set(key, value) {
      setStmt.run(key, String(value));
      return value;
    },
  };
}
