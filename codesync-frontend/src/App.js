import React, { useEffect, useRef, useState } from 'react';
import MonacoEditor from 'react-monaco-editor';
import axios from 'axios';
import { io } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';
import SimplePeer from 'simple-peer';
import './App.css';
import {
  FaMicrophone,
  FaMicrophoneSlash,
  FaVideo,
  FaVideoSlash,
  FaPaperPlane,
  FaUpload,
  FaCode,
} from 'react-icons/fa';
import { debounce } from 'lodash';
import { Terminal } from 'xterm';
import 'xterm/css/xterm.css';

const languageOptions = {
  c: {
    id: 50,
    label: 'C',
    template: `#include <stdio.h>\n\nint main() {\n    // Write your code here\n    return 0;\n}`,
  },
  cpp: {
    id: 54,
    label: 'C++',
    template: `#include <iostream>\nusing namespace std;\n\nint main() {\n    // Write your code here\n    return 0;\n}`,
  },
  python: {
    id: 71,
    label: 'Python',
    template: `# Write your code here\ndef add(a, b):\n    return a + b\n\nprint(add(2, 3))`,
  },
  java: {
    id: 62,
    label: 'Java',
    template: `public class Main {\n    public static void main(String[] args) {\n        // Write your code here\n        System.out.println("Hello, World!");\n    }\n}`,
  },
};

const socket = io('http://localhost:3000');

function App() {
  const [language, setLanguage] = useState('python');
  const [code, setCode] = useState(languageOptions['python'].template);
  const [output, setOutput] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [userInput, setUserInput] = useState('');
  const [terminalVisible, setTerminalVisible] = useState(false);

  const roomIdRef = useRef(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [stream, setStream] = useState(null);
  const localVideoRef = useRef();
  const remoteVideoRef = useRef();
  const peerRef = useRef(null);
  const skipNextRef = useRef(false);
  const editorRef = useRef(null);
  const terminalRef = useRef(null);
  const terminalContainerRef = useRef(null);

  useEffect(() => {
    const roomId = window.location.pathname.slice(1) || uuidv4();
    roomIdRef.current = roomId;

    if (!window.location.pathname.slice(1)) {
      window.history.replaceState(null, '', '/' + roomId);
    }

    socket.emit('join', roomId);

    socket.on('code-update', (incomingCode) => {
      if (skipNextRef.current) {
        skipNextRef.current = false;
        return;
      }
      setCode(incomingCode);
      if (editorRef.current) {
        editorRef.current.setValue(incomingCode);
      }
    });

    socket.on('chat-message', (msg) => {
      setChatMessages((prev) => [...prev, msg]);
    });

    socket.on('terminal-data', (data) => {
      if (terminalRef.current) {
        terminalRef.current.write(data);
      }
    });

    navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((userStream) => {
      setStream(userStream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = userStream;
      }

      socket.on('user-joined', (otherUserId) => {
        const peer = new SimplePeer({
          initiator: true,
          trickle: false,
          stream: userStream,
        });

        peer.on('signal', (signalData) => {
          socket.emit('signal', { to: otherUserId, from: socket.id, signal: signalData });
        });

        peer.on('stream', (remoteStream) => {
          setRemoteStream(remoteStream);
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
          }
        });

        peerRef.current = peer;
      });

      socket.on('signal', ({ from, signal }) => {
        const peer = new SimplePeer({
          initiator: false,
          trickle: false,
          stream: userStream,
        });

        peer.on('signal', (signalData) => {
          socket.emit('signal', { to: from, from: socket.id, signal: signalData });
        });

        peer.on('stream', (remoteStream) => {
          setRemoteStream(remoteStream);
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
          }
        });

        peer.signal(signal);
        peerRef.current = peer;
      });
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (terminalVisible && terminalContainerRef.current && !terminalRef.current) {
      const term = new Terminal({ cursorBlink: true, theme: { background: '#1e1e1e' } });
      terminalRef.current = term;
      term.open(terminalContainerRef.current);
      term.focus();
      term.onData((data) => {
        socket.emit('terminal-data', { roomId: roomIdRef.current, data });
        term.write(data); // Local echo
      });
    }
  }, [terminalVisible]);

  const debouncedEmit = useRef(
    debounce((code) => {
      socket.emit('code-change', { roomId: roomIdRef.current, code });
    }, 300)
  ).current;

  const handleCodeChange = (newCode) => {
    setCode(newCode);
    skipNextRef.current = true;
    debouncedEmit(newCode);
  };

  const handleRun = async () => {
    setOutput('Running...');
    try {
      const response = await axios.post('http://localhost:3000/run', {
        source_code: code,
        language_id: languageOptions[language].id,
        stdin: userInput,
      });

      const result = response.data;
      const resultText = result.stdout || result.stderr || result.compile_output || 'No output';
      setOutput(resultText);
    } catch (err) {
      setOutput('Error: ' + err.message);
    }
  };

  const handleLanguageChange = (e) => {
    const selectedLang = e.target.value;
    setLanguage(selectedLang);
    setCode(languageOptions[selectedLang].template);
    socket.emit('code-change', { roomId: roomIdRef.current, code: languageOptions[selectedLang].template });
  };

  const sendMessage = () => {
    if (chatInput.trim()) {
      socket.emit('chat-message', chatInput);
      setChatMessages((prev) => [...prev, `You: ${chatInput}`]);
      setChatInput('');
    }
  };

  const toggleMic = () => {
    const track = stream?.getAudioTracks()?.[0];
    if (track) {
      track.enabled = !track.enabled;
      setMicEnabled(track.enabled);
    }
  };

  const toggleVideo = () => {
    const track = stream?.getVideoTracks()?.[0];
    if (track) {
      track.enabled = !track.enabled;
      setVideoEnabled(track.enabled);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setUploadedFileName(file.name);
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target.result;
        setCode(content);
        socket.emit('code-change', { roomId: roomIdRef.current, code: content });
      };
      reader.readAsText(file);
    }
  };

  const handleTerminalOpen = () => {
    setTerminalVisible(true);
  };

  const handleTerminalClose = () => {
    setTerminalVisible(false);
    if (terminalRef.current) {
      terminalRef.current.dispose();
      terminalRef.current = null;
    }
  };

  const handleSaveSession = async () => {
    try {
      await axios.post('http://localhost:3000/save', {
        roomId: roomIdRef.current,
        language,
        code,
        files: uploadedFileName ? [{ filename: uploadedFileName, content: code }] : [],
      });
      alert('✅ Session saved successfully!');
    } catch (err) {
      alert('❌ Failed to save session: ' + err.message);
    }
  };

  const handleLoadSession = async () => {
    try {
      const response = await axios.get(`http://localhost:3000/session/${roomIdRef.current}`);
      const data = response.data;
      setLanguage(data.language);
      setCode(data.code);
      if (editorRef.current) {
        editorRef.current.setValue(data.code);
      }
      if (data.files && data.files.length > 0) {
        setUploadedFileName(data.files[0].filename);
      }
      alert('✅ Session loaded!');
    } catch (err) {
      alert('❌ Failed to load session: ' + err.message);
    }
  };

  return (
    <div className="app-container">
      <div className="top-bar">
        <FaCode className="logo-icon" />
        CodeSync
      </div>

      <div className="main-section">
        <div className="sidebar">
          <h4>Language</h4>
          <select value={language} onChange={handleLanguageChange}>
            {Object.keys(languageOptions).map((lang) => (
              <option key={lang} value={lang}>
                {languageOptions[lang].label}
              </option>
            ))}
          </select>
          <button onClick={handleRun}>▶️ Run</button>
          <button onClick={handleSaveSession}>💾 Save Session</button>
          <button onClick={handleLoadSession}>📂 Load Session</button>
          <div className="toggle-btns">
            <button onClick={toggleMic}>{micEnabled ? <FaMicrophone /> : <FaMicrophoneSlash />}</button>
            <button onClick={toggleVideo}>{videoEnabled ? <FaVideo /> : <FaVideoSlash />}</button>
          </div>
          <div className="file-upload">
            <label className="upload-btn">
              <FaUpload /> Upload File
              <input type="file" onChange={handleFileUpload} accept=".c,.cpp,.py,.java,.txt" />
            </label>
            {uploadedFileName && <div className="file-name">📄 {uploadedFileName}</div>}
          </div>
          <div style={{ marginTop: '10px' }}>
            <h4>Input (optional)</h4>
            <textarea
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              rows={4}
              style={{ width: '100%', borderRadius: '5px', padding: '8px' }}
              placeholder="Enter input for your code here..."
            />
          </div>
          <div style={{ marginTop: '10px' }}>
            <button onClick={handleTerminalOpen} style={{ padding: '6px 10px', borderRadius: '5px', marginBottom: '5px' }}>
              🖥️ Open Terminal
            </button>
          </div>
        </div>

        <div className="editor-section">
          <MonacoEditor
            height="100%"
            language={language === 'cpp' ? 'cpp' : language}
            theme="vs-dark"
            value={code}
            onChange={handleCodeChange}
            options={{ fontSize: 16 }}
            editorDidMount={(editor) => {
              editorRef.current = editor;
            }}
          />
        </div>

        <div className="right-panel">
          <div className="video-panel">
            <video ref={localVideoRef} autoPlay muted playsInline />
            <video ref={remoteVideoRef} autoPlay playsInline />
          </div>
          <div className="chat-box">
            <h4>💬 Chat</h4>
            <div className="chat-messages">
              {chatMessages.map((msg, i) => (
                <div key={i} className="chat-message">{msg}</div>
              ))}
            </div>
            <div className="chat-input">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Type a message..."
              />
              <button onClick={sendMessage}><FaPaperPlane /></button>
            </div>
          </div>
        </div>
      </div>

      <div className="output-section">
        <h3>Output:</h3>
        <pre>{output}</pre>
      </div>

      {terminalVisible && (
        <div className="terminal-overlay">
          <div className="terminal-box">
            <button className="terminal-close-btn" onClick={handleTerminalClose}>X</button>
            <div ref={terminalContainerRef} style={{ height: '100%', width: '100%' }} />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
