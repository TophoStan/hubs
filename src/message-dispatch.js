import "./utils/configs";
import { getAbsoluteHref } from "./utils/media-url-utils";
import { isValidSceneUrl } from "./utils/scene-url-utils";
import { spawnChatMessage } from "./react-components/chat-message";
import { SOUND_CHAT_MESSAGE, SOUND_QUACK, SOUND_SPECIAL_QUACK } from "./systems/sound-effects-system";
import ducky from "./assets/models/DuckyMesh.glb";
import { EventTarget } from "event-target-shim";
import { ExitReason } from "./react-components/room/ExitedRoomScreen";
import { LogMessageType } from "./react-components/room/ChatSidebar";
import { createNetworkedEntity } from "./utils/create-networked-entity";
import { add, testAsset, respawn } from "./utils/chat-commands";
import { isLockedDownDemoRoom } from "./utils/hub-utils";
import { loadState, clearState } from "./utils/entity-state-utils";
import { shouldUseNewLoader } from "./utils/bit-utils";
import toggleHubsFeatures from "./custom/featureToggle";
import configs from "./utils/configs";

let uiRoot;
// Handles user-entered messages
export default class MessageDispatch extends EventTarget {
  constructor(scene, entryManager, hubChannel, remountUI, mediaSearchStore) {
    super();
    this.scene = scene;
    this.entryManager = entryManager;
    this.hubChannel = hubChannel;
    this.remountUI = remountUI;
    this.mediaSearchStore = mediaSearchStore;
    this.presenceLogEntries = [];
  }

  addToPresenceLog(entry) {
    entry.key = Date.now().toString();

    const lastEntry = this.presenceLogEntries.length > 0 && this.presenceLogEntries[this.presenceLogEntries.length - 1];
    if (lastEntry && entry.type === "permission" && lastEntry.type === "permission") {
      if (
        lastEntry.body.permission === entry.body.permission &&
        parseInt(entry.key) - parseInt(lastEntry.key) < 10000
      ) {
        this.presenceLogEntries.pop();
      }
    }

    this.presenceLogEntries.push(entry);
    this.remountUI({ presenceLogEntries: this.presenceLogEntries });
    if (entry.type === "chat" && this.scene.is("loaded")) {
      this.scene.systems["hubs-systems"].soundEffectsSystem.playSoundOneShot(SOUND_CHAT_MESSAGE);
    }

    // Fade out and then remove
    setTimeout(() => {
      entry.expired = true;
      this.remountUI({ presenceLogEntries: this.presenceLogEntries });

      setTimeout(() => {
        this.presenceLogEntries.splice(this.presenceLogEntries.indexOf(entry), 1);
        this.remountUI({ presenceLogEntries: this.presenceLogEntries });
      }, 1000);
    }, 20000);
  }

  receive(message) {
    if (isLockedDownDemoRoom()) return;

    this.addToPresenceLog(message);
    this.dispatchEvent(new CustomEvent("message", { detail: message }));
  }

  log = (messageType, props) => {
    this.receive({ type: "log", messageType, props });
  };

  dispatch = message => {
    if (message.startsWith("/")) {
      const commandParts = message.substring(1).split(/\s+/);
      this.dispatchCommand(commandParts[0], ...commandParts.slice(1));
      document.activeElement.blur(); // Commands should blur
    } else {
      this.hubChannel.sendMessage(message);
    }
  };

  dispatchCommand = async (command, ...args) => {
    const entered = this.scene.is("entered");
    uiRoot = uiRoot || document.getElementById("ui-root");
    const isGhost = !entered && uiRoot && uiRoot.firstChild && uiRoot.firstChild.classList.contains("isGhost");

    // TODO: Some of the commands below should be available without requiring room entry.
    if (!entered && (!isGhost || command === "duck")) {
      this.log(LogMessageType.roomEntryRequired);
      return;
    }

    const avatarRig = document.querySelector("#avatar-rig");
    const scales = [0.0625, 0.125, 0.25, 0.5, 1.0, 1.5, 3, 5, 7.5, 12.5];
    const curScale = avatarRig.object3D.scale;
    let err;
    let physicsSystem;
    const captureSystem = this.scene.systems["capture-system"];

    switch (command) {
      case "fly":
        if (toggleHubsFeatures("flying", configs.FEATURES_TO_ENABLE)) {
          if (this.scene.systems["hubs-systems"].characterController.fly) {
            this.scene.systems["hubs-systems"].characterController.enableFly(false);
            this.log(LogMessageType.flyModeDisabled);
          } else {
            if (this.scene.systems["hubs-systems"].characterController.enableFly(true)) {
              this.log(LogMessageType.flyModeEnabled);
            }
          }

        }
        break;
      case "grow":
        for (let i = 0; i < scales.length; i++) {
          if (scales[i] > curScale.x) {
            avatarRig.object3D.scale.set(scales[i], scales[i], scales[i]);
            avatarRig.object3D.matrixNeedsUpdate = true;
            break;
          }
        }

        break;
      case "shrink":
        for (let i = scales.length - 1; i >= 0; i--) {
          if (curScale.x > scales[i]) {
            avatarRig.object3D.scale.set(scales[i], scales[i], scales[i]);
            avatarRig.object3D.matrixNeedsUpdate = true;
            break;
          }
        }

        break;
      case "leave":
        this.entryManager.exitScene();
        this.remountUI({ roomUnavailableReason: ExitReason.left });
        break;

      case "oldduck":
        spawnChatMessage(getAbsoluteHref(location.href, ducky));
        if (Math.random() < 0.01) {
          this.scene.systems["hubs-systems"].soundEffectsSystem.playSoundOneShot(SOUND_SPECIAL_QUACK);
        } else {
          this.scene.systems["hubs-systems"].soundEffectsSystem.playSoundOneShot(SOUND_QUACK);
        }
        break;
      case "duck":
        if (shouldUseNewLoader()) {
          const avatarPov = document.querySelector("#avatar-pov-node").object3D;
          const eid = createNetworkedEntity(APP.world, "duck");
          const obj = APP.world.eid2obj.get(eid);
          obj.position.copy(avatarPov.localToWorld(new THREE.Vector3(0, 0, -1.5)));
          obj.lookAt(avatarPov.getWorldPosition(new THREE.Vector3()));
        } else {
          spawnChatMessage(getAbsoluteHref(location.href, ducky));
        }
        if (Math.random() < 0.01) {
          this.scene.systems["hubs-systems"].soundEffectsSystem.playSoundOneShot(SOUND_SPECIAL_QUACK);
        } else {
          this.scene.systems["hubs-systems"].soundEffectsSystem.playSoundOneShot(SOUND_QUACK);
        }
        break;
      case "cube": {
        const avatarPov = document.querySelector("#avatar-pov-node").object3D;
        const eid = createNetworkedEntity(APP.world, "cube");
        const obj = APP.world.eid2obj.get(eid);
        obj.position.copy(avatarPov.localToWorld(new THREE.Vector3(0, 0, -1.5)));
        obj.lookAt(avatarPov.getWorldPosition(new THREE.Vector3()));
        break;
      }
      case "debug":
        physicsSystem = document.querySelector("a-scene").systems["hubs-systems"].physicsSystem;
        physicsSystem.setDebug(!physicsSystem.debugEnabled);
        break;
      case "vrstats":
        document.getElementById("stats").components["stats-plus"].toggleVRStats();
        break;
      case "scene":
        if (args[0]) {
          if (await isValidSceneUrl(args[0])) {
            err = this.hubChannel.updateScene(args[0]);
            if (err === "unauthorized") {
              this.log(LogMessageType.unauthorizedSceneChange);
            }
          } else {
            this.log(LogMessageType.invalidSceneUrl);
          }
        } else if (this.hubChannel.canOrWillIfCreator("update_hub")) {
          this.mediaSearchStore.sourceNavigateWithNoNav("scenes", "use");
        }

        break;
      case "rename":
        err = this.hubChannel.rename(args.join(" "));
        if (err === "unauthorized") {
          this.log(LogMessageType.unauthorizedRoomRename);
        }
        break;
      case "capture":
        if (!captureSystem.available()) {
          this.log(LogMessageType.captureUnavailable);
          break;
        }
        if (args[0] === "stop") {
          if (captureSystem.started()) {
            captureSystem.stop();
            this.log(LogMessageType.captureStopped);
          } else {
            this.log(LogMessageType.captureAlreadyStopped);
          }
        } else {
          if (captureSystem.started()) {
            this.log(LogMessageType.captureAlreadyRunning);
          } else {
            captureSystem.start();
            this.log(LogMessageType.captureStarted);
          }
        }
        break;
      case "audioNormalization":
        {
          if (args.length === 1) {
            const factor = Number(args[0]);
            if (!isNaN(factor)) {
              const effectiveFactor = Math.max(0.0, Math.min(255.0, factor));
              window.APP.store.update({
                preferences: { audioNormalization: effectiveFactor }
              });
              if (factor) {
                this.log(LogMessageType.setAudioNormalizationFactor, { factor: effectiveFactor });
              } else {
                this.log(LogMessageType.audioNormalizationDisabled);
              }
            } else {
              this.log(LogMessageType.audioNormalizationNaN);
            }
          } else {
            this.log(LogMessageType.invalidAudioNormalizationRange);
          }
        }
        break;
      case "add":
        {
          const avatarPov = document.querySelector("#avatar-pov-node").object3D;
          add(APP.world, avatarPov, args);
        }
        break;
      case "respawn":
        {
          const sceneEl = AFRAME.scenes[0];
          const characterController = this.scene.systems["hubs-systems"].characterController;
          respawn(APP.world, sceneEl, characterController);
        }
        break;
      case "test":
        {
          const avatarPov = document.querySelector("#avatar-pov-node").object3D;
          testAsset(APP.world, avatarPov, args);
        }
        break;
      case "load":
        {
          if (this.hubChannel.can("pin_objects") && this.hubChannel.signIn) {
            loadState(this.hubChannel, APP.world, args);
          }
        }
        break;
      case "clear":
        {
          if (this.hubChannel.can("pin_objects") && this.hubChannel.signIn) {
            clearState(this.hubChannel, APP.world);
          }
        }
        break;
    }
  };
}
