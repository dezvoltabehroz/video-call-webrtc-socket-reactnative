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
      finalLocalStream: null,
      callUserId: 1109,
      userId: 86,
      anscall: false,
      isAlreadyInCall: false,
      mediaConstraints: {
        audio: true,
        video: {
          width: 500,
          height: 500,
          frameRate: 30,
          facingMode: "user"
        }
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
    const configuration = { "iceServers": [{ "url": "stun:stun.l.google.com:19302" }] };
    rtcPeerConnection = new RTCPeerConnection(configuration);

    // rtcPeerConnection.onicecandidate = handleICECandidateEvent;
    // rtcPeerConnection.ontrack = handleTrackEvent;
    // rtcPeerConnection.onnegotiationneeded = handleNegotiationNeededEvent;
    // rtcPeerConnection.onremovetrack = handleRemoveTrackEvent;
    // rtcPeerConnection.oniceconnectionstatechange = handleICEConnectionStateChangeEvent;
    // rtcPeerConnection.onicegatheringstatechange = handleICEGatheringStateChangeEvent;
    // rtcPeerConnection.onsignalingstatechange = handleSignalingStateChangeEvent;

    this.recursiveFunctionCall();
  }

  recursiveFunctionCall = () => {
    const { isAlreadyInCall, mediaConstraints } = this.state;

    socket.on('ringing', (data) => { console.log("Ringing....", data) });

    socket.on('webrtc_offer', async (event) => {
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

    socket.on('busy', (data) => { console.log(data.endUserId + " is busy."); })

    socket.on('webrtc_answer', async (event) => {
      console.log('Socket event callback: webrtc_answer: ', event)
      caller = event.uid;
      callee = event.endUserId

      await rtcPeerConnection.setRemoteDescription(new RTCSessionDescription(event.sdp))
      console.log("rtcPeerConnection Receive : ", rtcPeerConnection)
      if (rtcPeerConnection.remoteDescription.type == "answer") {
        this.setState({ isAlreadyInCall: true, finalLocalStream: rtcPeerConnection._localStreams[0], remoteStream: rtcPeerConnection._remoteStreams[0], anscall: true, isCallConnected: true })
        socket.emit('call_started', { caller, callee })
      }
    })

    socket.on('webrtc_ice_candidate', (event) => {
      if (event.candidate) {
        rtcPeerConnection.addIceCandidate(event.candidate).catch(e => {
          console.log("Failure during addIceCandidate(): " + e.name);
        });
      }
    })

    socket.on('end_call', async (data) => {
      caller = null;
      callee = null;
      duration = null;
      socket.emit('clear_endUser')

    })

    socket.on('disconnected_end_call', async (data) => {
      socket.emit('disconnected_end_call', { caller, callee, duration })
      caller = null;
      callee = null;
      duration = null;
    })
  }

  componentDidMount = () => {
    socket.on("connection", (connectionData) => { });
    socket.emit('makeConnection', { uid: this.state.userId })
  }

  onCall = () => {
    this.setLocalStream()
      .then(() => {
        this.createOffer(rtcPeerConnection)
      })

  }

  setLocalStream = async () => {
    return new Promise((resolve, reject) => {
      mediaDevices.getUserMedia(this.state.mediaConstraints)
        .then(async (stream) => {
          rtcPeerConnection.addStream(stream);
          this.setState({ localStream: stream });
          resolve();
        })
        .catch((error) => { console.log("setLocalStream : ", error) });
    })
  }

  createOffer = (rtcPeerConnection) => {
    rtcPeerConnection.createOffer()
      .then(desc => {
        rtcPeerConnection.setLocalDescription(desc)
          .then(() => {
            socket.emit('webrtc_offer', {
              type: 'webrtc_offer',
              call_type: 'video',
              sdp: rtcPeerConnection.localDescription,
              remoteStream: this.state.localStream,
              endUserId: this.state.callUserId,
            })
          });
      });

    rtcPeerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc_ice_candidate', {
          uuid: this.state.callUserId,
          candidate: event.candidate.candidate,
        })
      }
    }


  }

  answerCall = () => {
    this.setLocalStream()
      .then(async () => {
        await rtcPeerConnection.setRemoteDescription(new RTCSessionDescription(this.state.event.sdp))
        if (rtcPeerConnection.remoteDescription.type == "offer") {
          this.createAnswer(rtcPeerConnection, this.state.event.endUserId)
        }
      })
  }

  createAnswer = (rtcPeerConnection, endUserId) => {
    rtcPeerConnection.createAnswer()
      .then(async (answer) => {
        await rtcPeerConnection.setLocalDescription(answer);
        let resData = rtcPeerConnection.localDescription;
        this.setState({ isAlreadyInCall: true })

        socket.emit('webrtc_answer', {
          type: 'webrtc_answer',
          call_type: 'video',
          remoteStream: this.state.localStream,
          sdp: resData,
          endUserId,
        })
        this.setState({ anscall: false, isCallConnected: true })
      })
      .catch(err => { console.log("Error during createAnswer : ", err) })
  }

  rejectCall = () => {
    this.setState({ anscall: false })
    socket.emit("reject-call", {
      call_type: 'video',
      to: this.state.event.endUserId
    });
  }

  render() {
    const { localStream, remoteStream, finalLocalStream, isCallConnected } = this.state;
    return (
      <View style={{ marginTop: '15%' }}>
        {
          isCallConnected ?
            <>
              <View style={{ height: 200, width: 200 }}>
                <RTCView
                  streamURL={finalLocalStream?.toURL()}
                  style={styles.localVideo}
                />
              </View>

              <View style={{ height: 200, width: 200 }}>
                <RTCView
                  streamURL={remoteStream?.toURL()}
                  style={styles.localVideo}
                />
              </View>
            </>
            :
            null
        }
        <View style={{ height: 40 }}>
          <Button title="Audio Call" onPress={() => this.onCall()} />
        </View>
        <View style={{ height: 40 }}>
          <Button title="Video Call" onPress={() => this.onCall()} />
        </View>
        {/* <View style={{ paddingVertical: "2.5%" }}>
          <TextInput placeholder="Your Id" value={this.state.userId} onChangeText={(data) => this.setState({ userId: data })} />
          <TextInput placeholder="Other User Id" value={this.state.callUserId} onChangeText={(data) => this.setState({ callUserId: data })} />
          <Button title="Make Connection" onPress={() => {
            socket.emit('makeConnection', { uid: this.state.userId })
          }} />
        </View> */}
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
      </View>
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