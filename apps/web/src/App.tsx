import { useEffect, useState } from "react";

function App() {
  const [apiStatus, setApiStatus] = useState("checking…");

  useEffect(() => {
    void fetch("/v1/health")
      .then((res) => (res.ok ? "ok" : `error ${res.status}`))
      .catch(() => "unreachable")
      .then(setApiStatus);
  }, []);

  return (
    <main>
      <h1>Flowboard</h1>
      <p>API: {apiStatus}</p>
    </main>
  );
}

export default App;
