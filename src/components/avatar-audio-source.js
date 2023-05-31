import { AudioType, SourceType } from "./audio-params";
import { getCurrentAudioSettings, updateAudioSettings } from "../update-audio-settings";
import { isRoomOwner } from "../utils/hub-utils";
import { updateAudio } from "../bit-systems/audio-emitter-system";
import { findAncestorWithComponent } from "../utils/scene-graph";
const INFO_INIT_FAILED = "Failed to initialize avatar-audio-source.";
const INFO_NO_NETWORKED_EL = "Could not find networked el.";
const INFO_NO_OWNER = "Networked component has no owner.";

// Chrome seems to require a MediaStream be attached to an AudioElement before AudioNodes work correctly
// We don't want to do this in other browsers, particularly in Safari, which actually plays the audio despite
// setting the volume to 0.
const SHOULD_CREATE_SILENT_AUDIO_ELS = /chrome/i.test(navigator.userAgent);
function createSilentAudioEl(stream) {
  const audioEl = new Audio();
  audioEl.setAttribute("autoplay", "autoplay");
  audioEl.setAttribute("playsinline", "playsinline");
  audioEl.srcObject = stream;
  audioEl.volume = 0; // we don't actually want to hear audio from this element
  return audioEl;
}

async function getOwnerId(el) {
  const networkedEl = await NAF.utils.getNetworkedEntity(el).catch(e => {
    console.error(INFO_INIT_FAILED, INFO_NO_NETWORKED_EL, e);
  });
  if (!networkedEl) {
    return null;
  }
  return networkedEl.components.networked.data.owner;
}

export async function getMediaStream(el) {
  const peerId = await getOwnerId(el);
  if (!peerId) {
    console.error(INFO_INIT_FAILED, INFO_NO_OWNER);
    return null;
  }
  const stream = await APP.dialog.getMediaStream(peerId).catch(e => {
    console.error(INFO_INIT_FAILED, `Error getting media stream for ${peerId}`, e);
  });
  if (!stream) {
    return null;
  }
  return stream;
}

AFRAME.registerComponent("avatar-audio-source", {
  createAudio: async function () {
    this.removeAudio();

    this.isCreatingAudio = true;
    const stream = await getMediaStream(this.el);
    this.isCreatingAudio = false;
    const isRemoved = !this.el.parentNode;
    if (!stream || isRemoved) return;

    APP.sourceType.set(this.el, SourceType.AVATAR_AUDIO_SOURCE);
    const { audioType } = getCurrentAudioSettings(this.el);
    let audio = APP.audios.get(this.el);
    if (audioType === AudioType.PannerNode) {
      audio = APP.audioCtx.createPanner();
    } else {
      audio = APP.audioCtx.createStereoPanner();
    }
    const gain = APP.audioCtx.createGain();
    gain.gain.value = 0;
    audio.connect(gain);

    this.audioSystem.addAudio({ sourceType: SourceType.AVATAR_AUDIO_SOURCE, node: gain });

    if (SHOULD_CREATE_SILENT_AUDIO_ELS) {
      createSilentAudioEl(stream); // TODO: Do the audio els need to get cleaned up?
    }

    APP.audios.set(this.el, audio);
    APP.gains.set(this.el, gain);

    this.mediaStreamSource = APP.audioCtx.createMediaStreamSource(stream);
    this.mediaStreamSource.connect(audio);
    this.el.emit("sound-source-set", { soundSource: audio });

    getOwnerId(this.el).then(async ownerId => {
      if (isRoomOwner(ownerId)) {
        APP.moderatorAudioSource.add(this.el);
      } else {
        APP.moderatorAudioSource.delete(this.el);
      }
      updateAudioSettings(this.el, audio);
      updateAudio(this.el, this.el.object3D, true);

      this.ikRootEl = findAncestorWithComponent(this.el, "ik-root");
      this.ikController = this.ikRootEl.querySelector(".AvatarRoot").components["ik-controller"];
    });
  },

  removeAudio() {
    const audio = APP.audios.get(this.el);
    if (audio) {
      this.audioSystem.removeAudio({ node: audio });
      APP.audios.delete(this.el);
      APP.gains.delete(this.el);
    }
  },

  init() {
    this.createAudio = this.createAudio.bind(this);
    this.onPermissionsUpdated = this.onPermissionsUpdated.bind(this);

    this.audioSystem = this.el.sceneEl.systems["hubs-systems"].audioSystem;
    // We subscribe to audio stream notifications for this peer to update the audio source
    // This could happen in case there is an ICE failure that requires a transport recreation.
    APP.dialog.on("stream_updated", this._onStreamUpdated, this);
    this.createAudio();

    let { disableLeftRightPanning, audioPanningQuality } = APP.store.state.preferences;
    this.onPreferenceChanged = () => {
      const newDisableLeftRightPanning = APP.store.state.preferences.disableLeftRightPanning;
      const newAudioPanningQuality = APP.store.state.preferences.audioPanningQuality;

      const shouldRecreateAudio = disableLeftRightPanning !== newDisableLeftRightPanning && !this.isCreatingAudio;
      const shouldUpdateAudioSettings = audioPanningQuality !== newAudioPanningQuality;

      disableLeftRightPanning = newDisableLeftRightPanning;
      audioPanningQuality = newAudioPanningQuality;

      if (shouldRecreateAudio) {
        this.createAudio();
      } else if (shouldUpdateAudioSettings) {
        // updateAudioSettings() is called in this.createAudio()
        // so no need to call it if shouldRecreateAudio is true.
        const audio = APP.audios.get(this.el);
        updateAudioSettings(this.el, audio);
      }
    };
    APP.store.addEventListener("statechanged", this.onPreferenceChanged);
    this.el.addEventListener("audio_type_changed", this.createAudio);
    APP.hubChannel.addEventListener("permissions_updated", this.onPermissionsUpdated);
  },

  onPermissionsUpdated() {
    getOwnerId(this.el).then(async ownerId => {
      if (isRoomOwner(ownerId)) {
        APP.moderatorAudioSource.add(this.el);
      } else {
        APP.moderatorAudioSource.delete(this.el);
      }
      const audio = APP.audios.get(this.el);
      audio && updateAudioSettings(this.el, audio);
    });
  },

  async _onStreamUpdated(peerId, kind) {
    getOwnerId(this.el).then(async ownerId => {
      if (ownerId === peerId && kind === "audio") {
        // The audio stream for this peer has been updated
        const newStream = await APP.dialog.getMediaStream(peerId, "audio").catch(e => {
          console.error(INFO_INIT_FAILED, `Error getting media stream for ${peerId}`, e);
        });

        if (newStream) {
          this.mediaStreamSource.disconnect();
          this.mediaStreamSource = APP.audioCtx.createMediaStreamSource(newStream);
          const audio = APP.audios.get(this.el);
          this.mediaStreamSource.connect(audio);
        }
      }
    });
  },

  remove: function () {
    APP.dialog.off("stream_updated", this._onStreamUpdated);
    APP.hubChannel.removeEventListener("permissions_updated", this.onPermissionsUpdated);

    window.APP.store.removeEventListener("statechanged", this.onPreferenceChanged);
    this.el.removeEventListener("audio_type_changed", this.createAudio);

    APP.audios.delete(this.el);
    APP.sourceType.delete(this.el);
    APP.supplementaryAttenuation.delete(this.el);

    this.removeAudio();
  },

  tick: function () {
    if (this.ikController && this.ikController.transformUpdated) {
      updateAudio(this.el, this.el.object3);
    }
  }
});

function createWhiteNoise(gain) {
  const bufferSize = 2 * APP.audioCtx.sampleRate,
    noiseBuffer = APP.audioCtx.createBuffer(1, bufferSize, APP.audioCtx.sampleRate),
    gainFilter = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    gainFilter[i] = (Math.random() * 2 - 1) * gain;
  }

  const whiteNoise = APP.audioCtx.createBufferSource();
  whiteNoise.buffer = noiseBuffer;
  whiteNoise.loop = true;
  whiteNoise.start(0);
  return whiteNoise;
}

const tmpWorldPos = new THREE.Vector3();

/**
 * @component zone-audio-source
 * This component looks for audio sources that get near it, keeping track
 * of them and making them available to other components. It currently only
 * supports avatars via the avatar-audio-source component, and only a single
 * source at a time, but this can easily be expanded in the future.
 */
AFRAME.registerComponent("zone-audio-source", {
  schema: {
    onlyMods: { default: true },
    muteSelf: { default: true },

    debug: { default: false }
  },

  init() {
    this.gainFilter = APP.audioCtx.createGain();
    if (this.data.debug) {
      this.whiteNoise = createWhiteNoise(0.01);
      this.setInput(this.whiteNoise);
    }

    // TODO this should probably be using bounds similar to media-frames and trigger-volume.
    // Doing the simple thing for now since we only support avatar audio sources currently
    this.el.object3D.updateMatrixWorld();
    const radius = this.el.object3D.matrixWorld.getMaxScaleOnAxis();
    this.boundingRadiusSquared = radius * radius;

    if (this.data.debug) {
      this.el.setObject3D(
        "debug",
        new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.SphereBufferGeometry(1, 10, 10)))
      );
    }
  },

  setInput(newInput) {
    if (this.input) {
      this.input.disconnect();
      this.input = null;
    }

    if (newInput) {
      newInput.connect(this.gainFilter);
      this.input = newInput;
    }
  },

  getGainFilter() {
    return this.gainFilter;
  },

  tick() {
    this.el.object3D.getWorldPosition(tmpWorldPos);
    if (this.trackingEl) {
      const distanceSquared = this.trackingEl.object3D.position.distanceToSquared(tmpWorldPos);
      if (distanceSquared > this.boundingRadiusSquared) {
        this.trackingEl = null;
        this.setInput(this.whiteNoise);
      }
    } else {
      const playerInfos = window.APP.componentRegistry["player-info"];
      for (let i = 0; i < playerInfos.length; i++) {
        const playerInfo = playerInfos[i];
        const avatar = playerInfo.el;

        if (this.data.onlyMods && !playerInfo.can("amplify_audio")) continue;
        // don't use avatar-rig if not entering scene yet.
        if (avatar.id === "avatar-rig" && !this.el.sceneEl.is("entered")) continue;

        const distanceSquared = avatar.object3D.position.distanceToSquared(tmpWorldPos);
        if (distanceSquared < this.boundingRadiusSquared) {
          this.trackingEl = avatar;
          if (this.data.muteSelf && this.trackingEl.id === "avatar-rig") {
            // Don't emit your own audio
            this.setInput(null);
          } else {
            getMediaStream(this.trackingEl).then(stream => {
              const node = APP.audioCtx.createMediaStreamSource(stream);
              this.setInput(node);
            });
          }
        }
      }
    }
  }
});

/**
 * @component audio-target
 * This component pulls audio from a "source" component and re-emits it.
 * Currently the audio can come from a zone-audio-source. A gain as well
 * as a random delay can be applied in addition to the standard positional
 * audio properties, to better simulate a real world speaker setup.
 */
AFRAME.registerComponent("audio-target", {
  schema: {
    minDelay: { default: 0.01 },
    maxDelay: { default: 0.13 },
    srcEl: { type: "selector" },
    debug: { default: false }
  },

  init() {
    this.audioSystem = this.el.sceneEl.systems["hubs-systems"].audioSystem;
    this.createAudio();
    // TODO this is to ensure targets and sources loaded at the same time don't have
    // an order depndancy but this should be done in a more robust way
    setTimeout(() => {
      this.connectAudio();
    }, 0);
    this.el.setAttribute("audio-zone-source");

    this.createAudio = this.createAudio.bind(this);
    this.el.addEventListener("audio_type_changed", this.createAudio);
  },

  remove: function () {
    APP.supplementaryAttenuation.delete(this.el);
    APP.audios.delete(this.el);
    APP.sourceType.delete(this.el);

    this.removeAudio();

    this.el.removeAttribute("audio-zone-source");
    this.el.removeEventListener("audio_type_changed", this.createAudio);
  },

  createAudio: function () {
    this.removeAudio();

    APP.sourceType.set(this.el, SourceType.AUDIO_TARGET);
    const { audioType } = getCurrentAudioSettings(this.el);
    let audio = APP.audios.get(this.el);
    if (audioType === AudioType.PannerNode) {
      audio = APP.audioCtx.createPanner();
    } else {
      audio = APP.audioCtx.createStereoPanner();
    }
    const gain = APP.audioCtx.createGain();
    gain.gain.value = 0;
    audio.connect(gain);

    if (this.data.maxDelay > 0) {
      this.delayNode = APP.audioCtx.createDelay(this.data.maxDelay);
      this.delayNode.delayTime.value = THREE.MathUtils.randFloat(this.data.minDelay, this.data.maxDelay);
      audio.connect(this.delayNode);
      this.audioSystem.addAudio({ sourceType: SourceType.AVATAR_AUDIO_SOURCE, node: this.delayNode });
    } else {
      this.audioSystem.addAudio({ sourceType: SourceType.AVATAR_AUDIO_SOURCE, node: audio });
    }

    APP.audios.set(this.el, audio);
    APP.gains.set(this.el, gain);
    updateAudioSettings(this.el, audio);
  },

  connectAudio() {
    const srcEl = this.data.srcEl;
    const srcZone = srcEl && srcEl.components["zone-audio-source"];
    const node = srcZone && srcZone.getGainFilter();
    if (node) {
      const audio = APP.audios.get(this.el);
      if (audio) {
        node.connect(audio);
      }
    } else {
      console.warn(`Failed to get audio from source for ${this.el.className}`, srcEl);
    }
  },

  removeAudio() {
    const audio = APP.audios.get(this.el);
    if (audio) {
      audio.disconnect();
      if (this.delayNode) {
        this.audioSystem.removeAudio({ node: this.delayNode });
      } else {
        this.audioSystem.removeAudio({ node: audio });
      }
      APP.audios.delete(this.el);
      APP.gains.delete(this.el);
    }
  }
});
