namespace FudgeCore {
  export type MapLightTypeToLightList = Map<TypeOfLight, ComponentLight[]>;

  export interface RenderPrepareOptions {
    ignorePhysics?: boolean;
  }

  /**
   * The main interface to the render engine, here WebGL (see superclass {@link RenderWebGL} and the RenderInjectors
   */
  export abstract class Render extends RenderWebGL {
    public static rectClip: Rectangle = new Rectangle(-1, 1, 2, -2);
    public static pickBuffer: Int32Array;
    public static nodesPhysics: RecycableArray<Node> = new RecycableArray();
    private static nodesSimple: RecycableArray<Node> = new RecycableArray();
    private static nodesAlpha: RecycableArray<Node> = new RecycableArray();
    private static timestampUpdate: number;

    // TODO: research if picking should be optimized using radius picking to filter

    //#region Prepare
    /**
     * Recursively iterates over the branch starting with the node given, recalculates all world transforms, 
     * collects all lights and feeds all shaders used in the graph with these lights. Sorts nodes for different
     * render passes.
     */
    public static prepare(_branch: Node, _options: RenderPrepareOptions = {}, _mtxWorld: Matrix4x4 = Matrix4x4.IDENTITY(), _lights: MapLightTypeToLightList = new Map(), _shadersUsed: (typeof Shader)[] = null): void {
      let firstLevel: boolean = (_shadersUsed == null);
      if (firstLevel) {
        _shadersUsed = [];
        Render.timestampUpdate = performance.now();
        Render.nodesSimple.reset();
        Render.nodesAlpha.reset();
        Render.nodesPhysics.reset();
        Render.dispatchEvent(new Event(EVENT.RENDER_PREPARE_START));
      }

      if (!_branch.isActive)
        return; // don't add branch to render list if not active

      _branch.nNodesInBranch = 1;
      _branch.radius = 0;

      _branch.dispatchEventToTargetOnly(new Event(EVENT.RENDER_PREPARE));
      _branch.timestampUpdate = Render.timestampUpdate;

      if (_branch.cmpTransform && _branch.cmpTransform.isActive)
        _branch.mtxWorld.set(Matrix4x4.MULTIPLICATION(_mtxWorld, _branch.cmpTransform.mtxLocal));
      else
        _branch.mtxWorld.set(_mtxWorld); // overwrite readonly mtxWorld of the current node


      let cmpRigidbody: ComponentRigidbody = _branch.getComponent(ComponentRigidbody);
      if (cmpRigidbody && cmpRigidbody.isActive) { //TODO: support de-/activation throughout
        Render.nodesPhysics.push(_branch); // add this node to physics list
        if (!_options?.ignorePhysics)
          this.transformByPhysics(_branch, cmpRigidbody);
      }


      let cmpLights: ComponentLight[] = _branch.getComponents(ComponentLight);
      for (let cmpLight of cmpLights) {
        if (!cmpLight.isActive)
          continue;
        let type: TypeOfLight = cmpLight.light.getType();
        let lightsOfType: ComponentLight[] = _lights.get(type);
        if (!lightsOfType) {
          lightsOfType = [];
          _lights.set(type, lightsOfType);
        }
        lightsOfType.push(cmpLight);
      }

      let cmpMesh: ComponentMesh = _branch.getComponent(ComponentMesh);
      let cmpMaterial: ComponentMaterial = _branch.getComponent(ComponentMaterial);
      if (cmpMesh && cmpMesh.isActive && cmpMaterial && cmpMaterial.isActive) {
        // TODO: careful when using particlesystem, pivot must not change node position
        cmpMesh.mtxWorld = Matrix4x4.MULTIPLICATION(_branch.mtxWorld, cmpMesh.mtxPivot);
        let shader: typeof Shader = cmpMaterial.material.getShader();
        if (_shadersUsed.indexOf(shader) < 0)
          _shadersUsed.push(shader);

        _branch.radius = cmpMesh.radius;
        if (cmpMaterial.sortForAlpha)
          Render.nodesAlpha.push(_branch); // add this node to render list
        else
          Render.nodesSimple.push(_branch); // add this node to render list
      }

      for (let child of _branch.getChildren()) {
        Render.prepare(child, _options, _branch.mtxWorld, _lights, _shadersUsed);

        _branch.nNodesInBranch += child.nNodesInBranch;
        let cmpMeshChild: ComponentMesh = child.getComponent(ComponentMesh);
        let position: Vector3 = cmpMeshChild ? cmpMeshChild.mtxWorld.translation : child.mtxWorld.translation;

        _branch.radius = Math.max(_branch.radius, Vector3.DIFFERENCE(position, _branch.mtxWorld.translation).magnitude + child.radius);
      }

      if (firstLevel) {
        Render.dispatchEvent(new Event(EVENT.RENDER_PREPARE_END));
        for (let shader of _shadersUsed)
          Render.setLightsInShader(shader, _lights);
      }

      //Calculate Physics based on all previous calculations    
      // Render.setupPhysicalTransform(_branch);
    }
    //#endregion

    //#region Picking
    /**
     * Used with a {@link Picker}-camera, this method renders one pixel with picking information 
     * for each node in the line of sight and return that as an unsorted {@link Pick}-array
     */
    public static pickBranch(_branch: Node, _cmpCamera: ComponentCamera): Pick[] { // TODO: see if third parameter _world?: Matrix4x4 would be usefull
      Render.ƒpicked = [];
      let size: number = Math.ceil(Math.sqrt(_branch.nNodesInBranch));
      Render.createPickTexture(size);
      Render.setBlendMode(BLEND.OPAQUE);

      for (let node of _branch.getIterator(true)) {
        let cmpMesh: ComponentMesh = node.getComponent(ComponentMesh);
        let cmpMaterial: ComponentMaterial = node.getComponent(ComponentMaterial);
        if (cmpMesh && cmpMesh.isActive && cmpMaterial && cmpMaterial.isActive) {
          let mtxMeshToView: Matrix4x4 = Matrix4x4.MULTIPLICATION(_cmpCamera.mtxWorldToView, cmpMesh.mtxWorld);
          Render.pick(node, node.mtxWorld, mtxMeshToView);
          // RenderParticles.drawParticles();
          Recycler.store(mtxMeshToView);
        }
      }

      Render.setBlendMode(BLEND.TRANSPARENT);

      let picks: Pick[] = Render.getPicks(size, _cmpCamera);
      Render.resetFrameBuffer();
      return picks;
    }
    //#endregion

    //#region Drawing
    public static draw(_cmpCamera: ComponentCamera): void {
      Render.drawList(_cmpCamera, this.nodesSimple);
      Render.drawListAlpha(_cmpCamera);
    }

    private static drawListAlpha(_cmpCamera: ComponentCamera): void {
      function sort(_a: Node, _b: Node): number {
        return (Reflect.get(_a, "zCamera") < Reflect.get(_b, "zCamera")) ? 1 : -1;
      }
      for (let node of Render.nodesAlpha)
        Reflect.set(node, "zCamera", _cmpCamera.pointWorldToClip(node.getComponent(ComponentMesh).mtxWorld.translation).z);

      let sorted: Node[] = Render.nodesAlpha.getSorted(sort);
      Render.drawList(_cmpCamera, sorted);
    }

    private static drawList(_cmpCamera: ComponentCamera, _list: RecycableArray<Node> | Array<Node>): void {
      for (let node of _list) {
        let cmpMesh: ComponentMesh = node.getComponent(ComponentMesh);
        let mtxMeshToView: Matrix4x4 = Matrix4x4.MULTIPLICATION(_cmpCamera.mtxWorldToView, cmpMesh.mtxWorld);
        let cmpMaterial: ComponentMaterial = node.getComponent(ComponentMaterial);
        Render.drawMesh(cmpMesh, cmpMaterial, cmpMesh.mtxWorld, mtxMeshToView);
        Recycler.store(mtxMeshToView);
      }
    }

    //#region Physics
    private static transformByPhysics(_node: Node, _cmpRigidbody: ComponentRigidbody): void {
      if (!Physics.world?.getBodyList().length)
        return;

      if (!_node.mtxLocal) {
        throw (new Error("ComponentRigidbody requires ComponentTransform at the same Node"));
      }

      _cmpRigidbody.checkCollisionEvents();
      _cmpRigidbody.checkTriggerEvents();

      if (_cmpRigidbody.physicsType == PHYSICS_TYPE.KINEMATIC) { //Case of Kinematic Rigidbody
        let mtxPivotWorld: Matrix4x4 = Matrix4x4.MULTIPLICATION(_node.mtxWorld, _cmpRigidbody.mtxPivot);
        _cmpRigidbody.setPosition(mtxPivotWorld.translation);
        _cmpRigidbody.setRotation(mtxPivotWorld.rotation);
        return;
      }

      //Override any position/rotation, disregard hierachy not established by joints
      let mutator: Mutator = {};
      mutator["rotation"] = _cmpRigidbody.getRotation();
      mutator["translation"] = _cmpRigidbody.getPosition();
      _node.mtxWorld.mutate(mutator);
      // Attention, node needs parent... but would using physics without make sense ?
      _node.mtxLocal.set(Matrix4x4.RELATIVE(_node.mtxWorld, _node.getParent().mtxWorld));
    }
  }
  //#endregion
}
