import { useEffect, useState } from "react";
import { Home } from "./Home.tsx";
import { Editor } from "./Editor.tsx";

function useHashRoute(): string {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export function App() {
  const hash = useHashRoute();
  const m = hash.match(/^#\/p\/([\w-]+)/);
  return m ? <Editor key={m[1]} projectId={m[1]} /> : <Home />;
}
