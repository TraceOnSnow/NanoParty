import { HomePage } from "./pages/HomePage.tsx";
import { JoinPage } from "./pages/JoinPage.tsx";
import { RoomPage } from "./pages/RoomPage.tsx";
import { usePath } from "./router.ts";

export function App() {
  const path = usePath();
  const join = path.match(/^\/join\/([\w-]+)$/);
  if (join?.[1]) return <JoinPage inviteToken={join[1]} />;
  const room = path.match(/^\/room\/([\w-]+)$/);
  if (room?.[1]) return <RoomPage key={room[1]} roomId={room[1]} />;
  return <HomePage />;
}
