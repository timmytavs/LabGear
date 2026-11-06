import { useEffect, useState } from "react";
import LandingPage from "./pages/LandingPage";
import DashboardPreview from "./components/layout/DashboardLayout";

function App() {
  const [apiStatus, setApiStatus] = useState("checking");

  useEffect(() => {
    const controller = new AbortController();

    async function checkBackend() {
      try {
        const response = await fetch("http://127.0.0.1:8000/", {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Backend unavailable");
        }

        const data = await response.json();

        setApiStatus(data.status === "success" ? "online" : "offline");
      } catch (error) {
        if (error.name !== "AbortError") {
          setApiStatus("offline");
        }
      }
    }

    checkBackend();
    return () => controller.abort();
  }, []);

  const isDevelopmentPreview =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("preview") === "dashboard";

  if (isDevelopmentPreview) {
    return <DashboardPreview />;
  }

  return <LandingPage apiStatus={apiStatus} />;
}

export default App;
