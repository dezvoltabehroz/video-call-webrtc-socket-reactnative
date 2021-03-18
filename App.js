import React, { useEffect, useState, useCallback, useRef, Component } from 'react';
import { View, StyleSheet, Alert, Button, TextInput, AsyncStorage, ScrollView } from 'react-native';

import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  RTCView,
  MediaStream,
  MediaStreamTrack,
  mediaDevices,
  registerGlobals,
} from 'react-native-webrtc';

import io from 'socket.io-client';
var socket = io('http://34.201.65.184:3000/');

var rtcPeerConnection = null;
var localStreamTemp = null;
var x = 0;

export default class App extends Component {

  constructor(props) {
    super(props);
    this.state = {
      localStream: null,
      remoteStream: null,
      callUserId: 1109,
      userId: 86,
      anscall: false,
      isAlreadyInCall: false,
      mediaConstraints: {
        audio: true,
        video: {
          mandatory: {
            minWidth: 500,
            minHeight: 100,
            minFrameRate: 30,
          },
          facingMode: 'user',
        },
      },
      event: null,
      isCallConnected: false,
      tempLocal: null,
      caller_remoteStream: null,
      answer_remoteStream: null,
    }
    this._bootstrapAsync();
    this.componentDidMount = this.componentDidMount.bind(this);
  }

  _bootstrapAsync = async () => {
    rtcPeerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
      ],
    });
    this.recursiveFunctionCall();
  }

  recursiveFunctionCall = () => {
    const { isAlreadyInCall, mediaConstraints } = this.state;

    socket.on('ringing', (data) => {
      console.log("Ringing....", data)
    });

    socket.on('webrtc_offer', async (event) => {
      console.log("webrtc_offer event : ", event)
      if (event.uid == this.state.userId) {
        if (isAlreadyInCall) {
          socket.emit('busy', {
            message: "User is busy.",
            call_type: 'video',
            endUserId: event.endUserId
          })
        } else {
          event.remoteStream.toURL = () => null;
          this.setState({ event: event, anscall: true, remoteStream: event.remoteStream })
        }
      }
    })

    socket.on('reject-call', (data) => {
      socket.emit('makeConnection', { uid: this.state.userId })
    })

    socket.on('busy', (data) => {
      console.log(data.endUserId + " is busy.");
    })

    socket.on('webrtc_answer', (event) => {
      console.log('Socket event callback: webrtc_answer')
      caller = event.uid;
      callee = event.endUserId
      rtcPeerConnection.setRemoteDescription(new RTCSessionDescription(event.sdp))
      this.setState({ isAlreadyInCall: true })
      socket.emit('call_started', { caller, callee })

      // start timer
      // timer = setInterval(countTimer, 1000);
    })

    socket.on('webrtc_ice_candidate', (event) => {
      console.log('Socket event callback: webrtc_ice_candidate')

      // ICE candidate configuration.
      var candidate = new RTCIceCandidate({
        sdpMLineIndex: event.label,
        candidate: event.candidate,
      })
      if (candidate) {
        rtcPeerConnection.addIceCandidate(candidate)
      }
    })

    socket.on('end_call', async (data) => {
      console.log("call ended by " + data.id);
      caller = null;
      callee = null;
      duration = null;
      socket.emit('clear_endUser')

    })

    socket.on('disconnected_end_call', async (data) => {
      console.log("call ended by " + data.id);
      socket.emit('disconnected_end_call', { caller, callee, duration })
      caller = null;
      callee = null;
      duration = null;
    })
  }

  componentDidMount = () => {
    socket.on("connection", (connectionData) => {
      console.log("Connection Data : ")
    });
    // socket.emit('makeConnection', { uid: this.state.userId })
  }

  onCall = () => {
    this.setLocalStream()
      .then(async () => {
        await this.createOffer(rtcPeerConnection)
      })

  }

  setLocalStream = async () => {
    return new Promise((resolve, reject) => {

      mediaDevices.getUserMedia(this.state.mediaConstraints)
        .then(async (stream) => {
          this.setState({ localStream: stream });
          resolve();
        })
        .catch((error) => { console.log(error) });
    })
  }

  createOffer = async (rtcPeerConnection) => {

    let sessionDescription
    try {
      sessionDescription = await rtcPeerConnection.createOffer()
      rtcPeerConnection.setLocalDescription(sessionDescription)

    } catch (error) {
      console.error(error)
    }
    console.log("Calling");
    rtcPeerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc_ice_candidate', {
          uuid: this.state.callUserId,
          label: event.candidate.sdpMLineIndex,
          candidate: event.candidate.candidate,
        })
      }
    }

    socket.emit('webrtc_offer', {
      type: 'webrtc_offer',
      call_type: 'video',
      sdp: sessionDescription,
      remoteStream: this.state.localStream,
      endUserId: this.state.callUserId,
    })
  }

  answerCall = async () => {
    await this.setLocalStream()
    rtcPeerConnection.setRemoteDescription(new RTCSessionDescription(this.state.event.sdp))
    this.createAnswer(rtcPeerConnection, this.state.event.endUserId)
      .then(() => {
        this.setState({ anscall: false, isCallConnected: true })
      })
  }

  createAnswer = async (rtcPeerConnection, endUserId) => {
    return new Promise(async (resolve, reject) => {
      console.log("Answering the call")
      let sessionDescription
      try {
        sessionDescription = await rtcPeerConnection.createAnswer()
        rtcPeerConnection.setLocalDescription(new RTCSessionDescription(sessionDescription))
      } catch (error) {
        console.error(error)
      }
      this.setState({ isAlreadyInCall: true })

      socket.emit('webrtc_answer', {
        type: 'webrtc_answer',
        call_type: 'video',
        remoteStream: this.state.localStream,
        sdp: sessionDescription,
        endUserId,
      })
      resolve();
    })
  }

  rejectCall = () => {
    this.setState({ anscall: false })
    socket.emit("reject-call", {
      call_type: 'video',
      to: this.state.event.endUserId
    });
  }

  render() {
    const { localStream, remoteStream, isCallConnected } = this.state;
    return (
      <>

        {
          isCallConnected ?
            <>
              <View style={{ height: 200, width: 200 }}>
                <RTCView
                  streamURL={localStream.id}
                  style={styles.localVideo}
                />
              </View>

              <View style={{ height: 200, width: 200 }}>
                <RTCView
                  streamURL={remoteStream.id}
                  style={styles.localVideo}
                />
              </View>
            </>
            :
            null
        }
        <View>
          <Button title="Call" onPress={() => this.onCall()} />
        </View>
        <View style={{ paddingVertical: "2.5%" }}>
          <TextInput placeholder="current" value={this.state.userId} onChangeText={(data) => this.setState({ userId: data })} />
          <TextInput placeholder="to user" value={this.state.callUserId} onChangeText={(data) => this.setState({ callUserId: data })} />
          <Button title="Make Connection" onPress={() => {
            socket.emit('makeConnection', { uid: this.state.userId })
          }} />
        </View>
        <View>
          {
            this.state.anscall ?
              <>
                <Button title="Answer Call" onPress={() => this.answerCall()} />
                <Button title="Reject Call" onPress={() => this.rejectCall()} />
              </>
              : null
          }
        </View>
      </>
    )
  }
}
const styles = StyleSheet.create({
  localVideos: {
    height: 100,
    marginBottom: 10,
  },
  remoteVideos: {
    height: 400,
  },
  localVideo: {
    backgroundColor: '#f2f2f2',
    height: '100%',
    width: '100%',
  },
});