import { useState, useEffect } from "react";

function App() {
  const [ws, setWs] = useState(null);
  const [testUrl, setTestUrl] = useState("");
  const [testResult, setTestResult] = useState(null);
  const [blockedDomains, setBlockedDomains] = useState([]);
  const [blockedKeywords, setBlockedKeywords] = useState([]);
  const [newRule, setNewRule] = useState("");
  const [ruleType, setRuleType] = useState("domain");
  const [logs, setLogs] = useState([]);

  // Add loading states
  const [isLoading, setIsLoading] = useState(true);
  const [isTestingUrl, setIsTestingUrl] = useState(false);
  const [isAddingRule, setIsAddingRule] = useState(false);
  const [wsStatus, setWsStatus] = useState("connecting");

  // WebSocket connection with reconnection
  useEffect(() => {
    let reconnectTimeout;
    let retryCount = 0;
    const maxRetries = 5;

    const connectWebSocket = () => {
      try {
        setWsStatus("connecting");
        const socket = new WebSocket("ws://localhost:8888/ws");

        socket.onopen = () => {
          console.log("Connected to WebSocket");
          setWsStatus("connected");
          setIsLoading(false);
          retryCount = 0; // Reset retry count on successful connection
        };

        socket.onmessage = (event) => {
          const data = JSON.parse(event.data);
          console.log("Received:", data);

          if (data.type === "rules") {
            setBlockedDomains(data.blockedDomains);
            setBlockedKeywords(data.blockedKeywords);
            setIsLoading(false);
          } else if (data.type === "test_result") {
            setTestResult(data);
            setIsTestingUrl(false);
            setLogs((prev) => [
              {
                timestamp: new Date().toLocaleTimeString(),
                ...data,
              },
              ...prev,
            ]);
          }
        };

        socket.onclose = (event) => {
          console.log("WebSocket disconnected:", event.code, event.reason);
          setWsStatus("disconnected");

          // Retry connection if not max retries
          if (retryCount < maxRetries) {
            retryCount++;
            const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
            console.log(
              `Reconnecting in ${delay}ms... (Attempt ${retryCount})`
            );
            reconnectTimeout = setTimeout(connectWebSocket, delay);
          } else {
            setIsLoading(false);
            console.log("Max retry attempts reached");
          }
        };

        socket.onerror = (error) => {
          console.error("WebSocket error:", error);
        };

        setWs(socket);
      } catch (error) {
        console.error("Error creating WebSocket:", error);
        setIsLoading(false);
      }
    };

    connectWebSocket();

    return () => {
      clearTimeout(reconnectTimeout);
      if (ws) {
        ws.close();
      }
    };
  }, []);

  // Test URL handler
  const handleTest = () => {
    if (!ws || !testUrl) return;

    // Format URL before testing
    let urlToTest = testUrl.trim();
    if (!urlToTest.startsWith("http://") && !urlToTest.startsWith("https://")) {
      urlToTest = `http://${urlToTest}`;
    }

    setIsTestingUrl(true);
    setTestResult(null);
    ws.send(
      JSON.stringify({
        type: "test_url",
        url: urlToTest,
      })
    );
  };
  // Add rule handler
  const handleAddRule = async () => {
    if (!newRule) return;

    setIsAddingRule(true);
    try {
      const response = await fetch("http://localhost:8888/add-rule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: ruleType,
          value: newRule,
        }),
      });

      if (response.ok) {
        setNewRule("");
      }
    } catch (error) {
      console.error("Error adding rule:", error);
    } finally {
      setIsAddingRule(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading proxy settings...</p>
          <p className="text-sm text-gray-500 mt-2">
            WebSocket Status: {wsStatus}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">Content Filter Proxy</h1>
          <div
            className={`px-3 py-1 rounded-full text-sm ${
              wsStatus === "connected"
                ? "bg-green-100 text-green-700"
                : "bg-red-100 text-red-700"
            }`}
          >
            {wsStatus === "connected" ? "Connected" : "Reconnecting..."}
          </div>
        </div>

        {/* Test URL Section */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">Test URL</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={testUrl}
              onChange={(e) => setTestUrl(e.target.value)}
              placeholder="Enter URL to test"
              className="flex-1 border rounded px-3 py-2"
              disabled={isTestingUrl}
            />
            <button
              onClick={handleTest}
              disabled={isTestingUrl || !testUrl}
              className={`px-4 py-2 rounded text-white ${
                isTestingUrl
                  ? "bg-blue-300 cursor-not-allowed"
                  : "bg-blue-500 hover:bg-blue-600"
              }`}
            >
              {isTestingUrl ? (
                <span className="flex items-center">
                  <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                  Testing...
                </span>
              ) : (
                "Test"
              )}
            </button>
          </div>
          {testResult && (
            <div
              className={`mt-4 p-3 rounded ${
                testResult.blocked
                  ? "bg-red-100 text-red-700"
                  : "bg-green-100 text-green-700"
              }`}
            >
              {testResult.reason}
            </div>
          )}
        </div>

        {/* Add Rule Section */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">Add Rule</h2>
          <div className="flex gap-2">
            <select
              value={ruleType}
              onChange={(e) => setRuleType(e.target.value)}
              className="border rounded px-3 py-2"
              disabled={isAddingRule}
            >
              <option value="domain">Domain</option>
              <option value="keyword">Keyword</option>
            </select>
            <input
              type="text"
              value={newRule}
              onChange={(e) => setNewRule(e.target.value)}
              placeholder={`Enter ${ruleType} to block`}
              className="flex-1 border rounded px-3 py-2"
              disabled={isAddingRule}
            />
            <button
              onClick={handleAddRule}
              disabled={isAddingRule || !newRule}
              className={`px-4 py-2 rounded text-white ${
                isAddingRule
                  ? "bg-blue-300 cursor-not-allowed"
                  : "bg-blue-500 hover:bg-blue-600"
              }`}
            >
              {isAddingRule ? (
                <span className="flex items-center">
                  <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                  Adding...
                </span>
              ) : (
                "Add"
              )}
            </button>
          </div>
        </div>

        {/* Rules Display */}
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">Blocked Domains</h2>
            <div className="space-y-2">
              {blockedDomains.map((domain) => (
                <div
                  key={domain}
                  className="bg-red-50 text-red-700 px-3 py-2 rounded"
                >
                  {domain}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">Blocked Keywords</h2>
            <div className="space-y-2">
              {blockedKeywords.map((keyword) => (
                <div
                  key={keyword}
                  className="bg-yellow-50 text-yellow-700 px-3 py-2 rounded"
                >
                  {keyword}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Logs Section */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4">Access Logs</h2>
          <div className="space-y-3">
            {logs.map((log, index) => (
              <div
                key={index}
                className={`p-3 rounded border-l-4 ${
                  log.blocked
                    ? "bg-red-50 border-red-500"
                    : "bg-green-50 border-green-500"
                }`}
              >
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{log.timestamp}</span>
                  <span
                    className={log.blocked ? "text-red-600" : "text-green-600"}
                  >
                    {log.blocked ? "BLOCKED" : "ALLOWED"}
                  </span>
                </div>
                <div className="mt-1 text-gray-600">
                  <div>URL: {log.url}</div>
                  <div>Reason: {log.reason}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
