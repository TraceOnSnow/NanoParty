import { useEffect, useState } from "react";
import { testApi } from "../api.ts";
import { navigate } from "../router.ts";

/** Creates a room filled with test players (test environments only). */
export function TestPage() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [players, setPlayers] = useState(4);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    testApi
      .health()
      .then((h) => setEnabled(h.testMode === true))
      .catch(() => setEnabled(false));
  }, []);
  return (
    <main className="center-page">
      <div className="card form">
        <h1>多人测试房间</h1>
        {enabled === false && <p className="error">这台服务器没有开启测试模式（TEST_MODE=true），无法使用。</p>}
        {enabled && (
          <>
            <p className="muted">
              一键创建带多名测试玩家的房间，在同一个窗口里切换视角。测试玩家的操作和真人一样经过服务端校验。
            </p>
            <label>
              玩家人数
              <select value={players} onChange={(e) => setPlayers(Number(e.target.value))}>
                {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>
                    {n} 人
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="primary"
              onClick={async () => {
                try {
                  navigate(`/room/${await testApi.createRoom(players)}?seat=0`);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "创建失败");
                }
              }}
            >
              创建测试房间
            </button>
          </>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </main>
  );
}
