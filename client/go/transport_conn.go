package main

import (
	"context"
	"net"
	"time"
	"syscall/js"
	"github.com/coder/websocket"
)

type TransportConn struct {
	conn         net.Conn
	wsConn       *websocket.Conn
	pingInterval time.Duration
	closeCh      chan struct{}
	started      bool
}

func NewTransportConn(ctx context.Context, jsWsUrl js.Value) (*TransportConn, error) {
	// Convert jsWsUrl (js.Value) to a Go string
	wsUrl := jsWsUrl.String()
	// Establish WebSocket connection
	ws, _, err := websocket.Dial(ctx, wsUrl, nil)
	if err != nil {
		return nil, err
	}
	// Convert the WebSocket connection to a net.Conn
	conn := websocket.NetConn(ctx, ws, websocket.MessageBinary)
	tconn := &TransportConn{
		conn:         conn,
		wsConn:       ws,
		pingInterval: 30 * time.Second,
		closeCh:      make(chan struct{}),
	}
	return tconn, nil
}

func (d *TransportConn) Read(p []byte) (int, error) {
	return d.conn.Read(p)
}

func (d *TransportConn) Write(p []byte) (int, error) {
	return d.conn.Write(p)
}

func (d *TransportConn) Close() error {
	close(d.closeCh)
	return d.conn.Close()
}

func (d *TransportConn) LocalAddr() net.Addr {
	return d.conn.LocalAddr()
}

func (d *TransportConn) RemoteAddr() net.Addr {
	return d.conn.RemoteAddr()
}

func (d *TransportConn) SetDeadline(t time.Time) error {
	return d.conn.SetDeadline(t)
}

func (d *TransportConn) SetReadDeadline(t time.Time) error {
	return d.conn.SetReadDeadline(t)
}

func (d *TransportConn) SetWriteDeadline(t time.Time) error {
	return d.conn.SetWriteDeadline(t)
}
