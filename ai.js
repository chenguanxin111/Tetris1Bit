/**
 * TetrisAI - 俄罗斯方块AI模块
 * 
 * 基于 Pierre Dellacherie 算法实现
 * 该算法通过评估棋盘的各种特征来决定最佳落点
 * 
 * 主要特征：
 * 1. Landing Height - 下落高度
 * 2. Eroded Cells - 侵蚀单元格（消除行中属于当前方块的格数）
 * 3. Row Transitions - 行变换
 * 4. Column Transitions - 列变换
 * 5. Buried Holes - 埋藏空洞
 * 6. Wells - 井（垂直空列）
 * 7. T-Spin Bonus - T-Spin额外奖励
 */

const TetrisAI = {
  // ==================== 1. 算法权重配置 ====================
  
  /**
   * Pierre Dellacherie 算法权重（经典值，经过大量训练优化）
   * 这些权重决定了各个特征在评估函数中的重要性
   * 负值表示该特征对评分有负面影响，正值表示正面影响
   */
  WEIGHTS: {
    LANDING_HEIGHT: -4.500158825082766,   // 下落高度权重（负值：越高越差）
    ERODED_CELLS: 3.4181268101392694,     // 侵蚀单元格权重（正值：消除越多越好）
    ROW_TRANSITIONS: -3.2178882868487753, // 行变换权重（负值：变换越少越好）
    COL_TRANSITIONS: -9.348695305445199,  // 列变换权重（负值：变换越少越好）
    BURIED_HOLES: -7.899265427351652,     // 埋藏空洞权重（负值：空洞越少越好）
    WELLS: -3.3855972247263626,           // 井深度权重（负值：井越浅越好）
    T_SPIN_BONUS: 50.0                    // T-Spin额外奖励
  },

  // ==================== 2. SRS踢墙表 ====================
  
  /**
   * SRS（Super Rotation System）踢墙表
   * 用于处理方块旋转时的边界情况
   * 索引: [起始旋转][目标旋转] -> [[x偏移, y偏移], ...]
   * 
   * 当方块旋转时如果发生碰撞，会依次尝试这些偏移量
   * 直到找到一个不碰撞的位置，或全部尝试失败
   */
  SRS_KICKS: {
    0: {
      1: [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],  // 0->1（顺时针90度）
      3: [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]]      // 0->3（逆时针90度）
    },
    1: {
      2: [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],      // 1->2
      0: [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]]       // 1->0
    },
    2: {
      3: [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],     // 2->3
      1: [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]]   // 2->1
    },
    3: {
      0: [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],   // 3->0
      2: [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]]    // 3->2
    }
  },

  // ==================== 3. 主决策接口 ====================
  
  /**
   * 主决策接口 - AI的核心入口函数
   * 
   * @param {Object} gameState - GameControl.getState() 提供的游戏状态对象
   *   - board: 10x20 二维数组 (0=空, 1=有块)
   *   - current: 当前方块 {type, rotation, x, y}
   *   - queue: [下一个, 未来第2个, 未来第3个] 方块数组
   *   - level: 当前等级
   *   - score: 当前分数
   * @returns {Array} 动作序列，如 ['R','R','U','H']
   *   - 'L': 左移
   *   - 'R': 右移
   *   - 'U': 旋转
   *   - 'D': 软降
   *   - 'H': 硬降
   *   - 'N': 无操作
   */
  decide: function(gameState) {
    // 深度配置：1=只看当前, 2=看当前+下一个, 3=看全部（性能消耗大）
    // 深度越大，AI越强但计算越慢
    const LOOKAHEAD_DEPTH = 2; 
    
    // 调用搜索算法找到最佳移动
    const bestMove = this.findBestMove(
      gameState.board, 
      gameState.current, 
      gameState.queue,
      LOOKAHEAD_DEPTH
    );
    
    // 如果没有找到有效移动，直接硬降
    if (!bestMove) {
      console.log("AI: 无有效移动，硬降");
      return ['H'];
    }
    
    console.log("AI 决策:", bestMove.score.toFixed(2), bestMove.actions);
    return bestMove.actions;
  },

  // ==================== 4. 搜索算法（DFS） ====================
  
  /**
   * 寻找最佳移动
   * 使用深度优先搜索（DFS）遍历所有可能的落点
   * 
   * @param {Array} board - 当前棋盘状态（10x20二维数组）
   * @param {Object} piece - 当前方块 {type, rotation, x, y}
   * @param {Array} queue - 未来方块队列
   * @param {Number} depth - 搜索深度（用于递归）
   * @returns {Object} 最佳落点对象，包含piece, actions, score等
   */
  findBestMove: function(board, piece, queue, depth) {
    // 生成当前方块的所有可能落点
    const placements = this.generatePlacements(board, piece);
    if (placements.length === 0) return null;  // 无有效落点
    
    let bestScore = -Infinity;
    let bestMove = null;
    
    // 遍历当前方块的所有可能落点
    for (const placement of placements) {
      let score = 0;
      
      // 模拟放置，获取新棋盘状态
      const result = this.simulatePlacement(board, placement.piece);
      
      if (depth <= 1 || queue.length === 0) {
        // 单层评估：直接评估模拟后的棋盘
        score = this.evaluateBoard(result.board, placement);
      } else {
        // 多层评估：递归评估下一个方块
        const nextPiece = queue[0];
        const nextQueue = queue.slice(1);
        
        // 递归查找下一个方块的最佳落点
        const nextBest = this.findBestMove(result.board, nextPiece, nextQueue, depth - 1);
        
        if (nextBest) {
          // 累加当前评分和未来评分的折扣值（0.8是折扣因子）
          score = placement.immediateScore + 0.8 * nextBest.score; 
        } else {
          score = placement.immediateScore;
        }
      }
      
      // 更新最佳落点
      if (score > bestScore) {
        bestScore = score;
        bestMove = placement;
      }
    }

    if (bestMove) {
        bestMove.score = bestScore;
    }
    
    return bestMove;
  },

  /**
   * 生成所有可能的落点（使用BFS搜索可达位置）
   * 
   * 算法思路：
   * 1. 从初始位置开始BFS
   * 2. 每次可以左移、右移或旋转
   * 3. 对每个位置执行硬降，得到一个落点
   * 4. 记录到达每个落点需要的动作序列
   * 
   * @param {Array} board - 当前棋盘状态
   * @param {Object} piece - 当前方块
   * @returns {Array} 所有可能的落点数组
   */
  generatePlacements: function(board, piece) {
    const placements = [];  // 存储所有落点
    const visited = new Set();  // 记录已访问的状态
    
    // BFS队列，每个元素包含当前方块状态和到达该状态的动作序列
    const queue = [{
      piece: { ...piece },
      actions: []
    }];

    while (queue.length > 0) {
      const current = queue.shift();
      
      // 生成状态键（用于去重）
      const stateKey = `${current.piece.x},${current.piece.y},${current.piece.rotation}`;
      
      if (visited.has(stateKey)) continue;
      visited.add(stateKey);

      // 1. 尝试硬降（这是一个可能的落点）
      const droppedPiece = this.simulateHardDrop(board, current.piece);
      const dropKey = `D:${droppedPiece.x},${droppedPiece.y},${droppedPiece.rotation}`;
      
      if (!visited.has(dropKey)) {
        visited.add(dropKey);
        const finalActions = [...current.actions, 'H'];  // 添加硬降动作
        const result = this.simulatePlacement(board, droppedPiece);
        
        // 创建落点对象
        const placement = {
          piece: droppedPiece,
          actions: finalActions,
          rotation: droppedPiece.rotation,
          x: droppedPiece.x,
          y: droppedPiece.y,
          clearedLines: result.clearedLines,  // 消除行数
          erodedCells: result.erodedCells,    // 侵蚀单元格数
          isTSpin: droppedPiece.type === 'T' && this.checkTSpin(board, droppedPiece),
          immediateScore: 0
        };
        
        // 立即评估该落点的分数
        placement.immediateScore = this.evaluateBoard(result.board, placement);
        placements.push(placement);
      }

      // 2. 尝试向左移动
      const leftPiece = { ...current.piece, x: current.piece.x - 1 };
      if (!this.checkCollision(board, leftPiece)) {
        queue.push({ piece: leftPiece, actions: [...current.actions, 'L'] });
      }

      // 3. 尝试向右移动
      const rightPiece = { ...current.piece, x: current.piece.x + 1 };
      if (!this.checkCollision(board, rightPiece)) {
        queue.push({ piece: rightPiece, actions: [...current.actions, 'R'] });
      }

      // 4. 尝试顺时针旋转（带SRS踢墙）
      const nextRot = (current.piece.rotation + 1) % 4;
      const kicks = this.SRS_KICKS[current.piece.rotation][nextRot];
      if (kicks) {
        for (const [kx, ky] of kicks) {
          // 应用踢墙偏移
          const kickPiece = { 
            ...current.piece, 
            rotation: nextRot, 
            x: current.piece.x + kx, 
            y: current.piece.y - ky 
          };
          if (!this.checkCollision(board, kickPiece)) {
            queue.push({ piece: kickPiece, actions: [...current.actions, 'U'] });
            break; // 找到第一个有效的踢墙偏移即可
          }
        }
      }
    }
    
    return placements;
  },

  /**
   * T-Spin 判定 (3-Corner Rule)
   * 
   * T-Spin是俄罗斯方块中的高级技巧，指T方块旋转后卡入狭窄空间
   * 判定条件：T方块中心的四个对角中至少有3个被占据
   * 
   * @param {Array} board - 当前棋盘状态
   * @param {Object} piece - T方块对象
   * @returns {boolean} 是否构成T-Spin
   */
  checkTSpin: function(board, piece) {
    if (piece.type !== 'T') return false;
    
    // T方块中心点在 4x4 矩阵中通常是 (1, 1)
    const centerX = piece.x + 1;
    const centerY = piece.y + 1;
    
    let corners = 0;
    const cornerOffsets = [[0,0], [2,0], [0,2], [2,2]];  // 四个对角位置
    
    for (const [ox, oy] of cornerOffsets) {
      const bx = centerX - 1 + ox;
      const by = centerY - 1 + oy;
      
      // 墙壁或已有方块都算作占据
      if (bx < 0 || bx >= 10 || by >= 20 || (by >= 0 && board[by][bx])) {
        corners++;
      }
    }
    
    return corners >= 3;  // 3个或4个角被占据即为T-Spin
  },

  /**
   * 生成从起始状态到目标状态的动作序列
   * 注意：此函数当前未被使用，因为动作序列已在generatePlacements中通过BFS生成
   * 保留用于兼容性和可能的未来扩展
   * 
   * @param {Object} startPiece - 起始方块状态
   * @param {Object} endPiece - 目标方块状态
   * @param {Number} targetRot - 目标旋转状态
   * @param {Number} targetX - 目标X位置
   * @returns {Array} 动作序列
   */
  generateActions: function(startPiece, endPiece, targetRot, targetX) {
    const actions = [];
    let currentRot = startPiece.rotation;
    let currentX = startPiece.x;
    
    // 旋转动作
    while (currentRot !== endPiece.rotation) {
      actions.push('U');
      currentRot = (currentRot + 1) % 4;
    }
    
    // 水平移动
    while (currentX < targetX) {
      actions.push('R');
      currentX++;
    }
    while (currentX > targetX) {
      actions.push('L');
      currentX--;
    }
    
    // 硬降
    actions.push('H');
    return actions;
  },

  // ==================== 5. 模拟与碰撞检测 ====================

  /**
   * 模拟放置：将方块放置到棋盘上，返回新棋盘状态和消除信息
   * 
   * @param {Array} board - 当前棋盘状态
   * @param {Object} piece - 要放置的方块
   * @returns {Object} 包含新棋盘、消除行数、侵蚀单元格数的对象
   */
  simulatePlacement: function(board, piece) {
    // 深拷贝棋盘
    const newBoard = board.map(row => [...row]);
    const matrix = SHAPES[piece.type][piece.rotation];
    const pieceCells = [];  // 记录当前方块放置后的所有单元格坐标
    
    // 将方块放置到新棋盘
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        if (!matrix[y][x]) continue;
        const boardY = piece.y + y;
        const boardX = piece.x + x;
        if (boardY >= 0 && boardY < 20 && boardX >= 0 && boardX < 10) {
          newBoard[boardY][boardX] = 1;
          pieceCells.push({x: boardX, y: boardY});
        }
      }
    }
    
    // 处理消行并计算侵蚀格数
    let clearedLines = 0;
    let pieceCellsRemoved = 0;
    const finalBoard = [];
    
    for (let y = 0; y < 20; y++) {
      if (newBoard[y].every(cell => cell === 1)) {
        // 该行已满，将被消除
        clearedLines++;
        // 检查这一行中有多少个单元格属于当前放置的方块
        pieceCellsRemoved += pieceCells.filter(c => c.y === y).length;
      } else {
        // 该行未满，保留
        finalBoard.push(newBoard[y]);
      }
    }
    
    // 在顶部补充新的空行
    while (finalBoard.length < 20) {
      finalBoard.unshift(new Array(10).fill(0));
    }
    
    return {
      board: finalBoard,
      clearedLines: clearedLines,
      erodedCells: clearedLines * pieceCellsRemoved  // PD算法定义: 消行数 * 该方块在消行中贡献的格数
    };
  },

  /**
   * 检查碰撞（与board边界或已存在方块）
   * 
   * @param {Array} board - 当前棋盘状态
   * @param {Object} piece - 要检查的方块
   * @returns {boolean} 是否发生碰撞
   */
  checkCollision: function(board, piece) {
    const matrix = SHAPES[piece.type][piece.rotation];
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        if (!matrix[y][x]) continue;
        
        const boardX = piece.x + x;
        const boardY = piece.y + y;
        
        // 边界检查（左右和底部）
        if (boardX < 0 || boardX >= 10 || boardY >= 20) return true;
        
        // 与已有方块碰撞（注意boardY<0时为生成区，不算碰撞）
        if (boardY >= 0 && board[boardY][boardX]) return true;
      }
    }
    return false;
  },

  /**
   * 模拟硬降：返回下落到底后的位置
   * 不改变原始方块对象，返回新的位置
   * 
   * @param {Array} board - 当前棋盘状态
   * @param {Object} piece - 要下落的方块
   * @returns {Object} 下落后的方块对象（新对象）
   */
  simulateHardDrop: function(board, piece) {
    let dropY = piece.y;
    // 一直下落直到碰撞
    while (!this.checkCollision(board, {...piece, y: dropY + 1})) {
      dropY++;
    }
    return {...piece, y: dropY};
  },

  // ==================== 6. Pierre Dellacherie 评估函数 ====================

  /**
   * 评估棋盘状态（核心算法）
   * 
   * 根据Pierre Dellacherie算法，综合考虑多个特征来评估棋盘好坏
   * 评分越高表示该落点越优
   * 
   * @param {Array} board - 评估的棋盘状态
   * @param {Object} placement - 落点信息
   * @returns {Number} 评估分数
   */
  evaluateBoard: function(board, placement) {
    // 计算各项特征
    const features = {
      landingHeight: this.getLandingHeight(placement),
      erodedCells: this.getErodedCells(board, placement),
      rowTransitions: this.getRowTransitions(board),
      colTransitions: this.getColTransitions(board),
      buriedHoles: this.getBuriedHoles(board),
      wells: this.getWells(board),
      tSpin: placement.isTSpin ? 1 : 0
    };
    
    // 线性组合：各项特征乘以对应权重后求和
    let score = 0;
    score += features.landingHeight * this.WEIGHTS.LANDING_HEIGHT;
    score += features.erodedCells * this.WEIGHTS.ERODED_CELLS;
    score += features.rowTransitions * this.WEIGHTS.ROW_TRANSITIONS;
    score += features.colTransitions * this.WEIGHTS.COL_TRANSITIONS;
    score += features.buriedHoles * this.WEIGHTS.BURIED_HOLES;
    score += features.wells * this.WEIGHTS.WELLS;
    score += features.tSpin * this.WEIGHTS.T_SPIN_BONUS;
    
    return score;
  },

  /**
   * 特征1: 下落高度（Landing Height）
   * 
   * 计算方块质心从底部算起的高度
   * 高度越低越好，因为高处下落可能导致更多空洞
   * 
   * @param {Object} placement - 落点信息
   * @returns {Number} 平均下落高度
   */
  getLandingHeight: function(placement) {
    const piece = placement.piece;
    const matrix = SHAPES[piece.type][piece.rotation];
    let sumY = 0;
    let count = 0;
    
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        if (matrix[y][x]) {
          // boardY = piece.y + y
          // 从底部算起的高度：20 - boardY
          // 例如最底行 y=19, 高度为 1
          sumY += (20 - (piece.y + y));
          count++;
        }
      }
    }
    return sumY / count;  // 返回平均高度
  },

  /**
   * 特征2: 侵蚀单元格（Eroded Cells）
   * 
   * 消除行数 × 消除行中属于当前方块的单元格数
   * 这是Pierre Dellacherie算法的核心概念：
   * 不仅看消除多少行，还要看当前方块在消除中的贡献
   * 
   * @param {Array} board - 当前棋盘状态
   * @param {Object} placement - 落点信息
   * @returns {Number} 侵蚀单元格数
   */
  getErodedCells: function(board, placement) {
    return placement.erodedCells || 0;
  },

  /**
   * 特征3: 行变换（Row Transitions）
   * 
   * 同行中相邻单元格从有块到空或从空到有块的次数
   * 变换越多表示行越"不平整"，会增加放置难度
   * 边界（墙壁）视为有块
   * 
   * @param {Array} board - 当前棋盘状态
   * @returns {Number} 行变换总数
   */
  getRowTransitions: function(board) {
    let transitions = 0;
    for (let y = 0; y < 20; y++) {
      let prev = 1;  // 左边界视为有块（从墙到第一个cell）
      for (let x = 0; x < 10; x++) {
        const curr = board[y][x];
        if (curr !== prev) transitions++;
        prev = curr;
      }
      if (prev === 0) transitions++;  // 右边界检查
    }
    return transitions;
  },

  /**
   * 特征4: 列变换（Column Transitions）
   * 
   * 同列中相邻行从有块到空或从空到有块的次数
   * 变换越多表示列越"不平整"
   * 底部边界视为有块
   * 
   * @param {Array} board - 当前棋盘状态
   * @returns {Number} 列变换总数
   */
  getColTransitions: function(board) {
    let transitions = 0;
    for (let x = 0; x < 10; x++) {
      let prev = 1;  // 地面视为有块
      for (let y = 19; y >= 0; y--) {  // 从底部向上遍历
        const curr = board[y][x];
        if (curr !== prev) transitions++;
        prev = curr;
      }
    }
    return transitions;
  },

  /**
   * 特征5: 埋藏空洞（Buried Holes）
   * 
   * 被方块覆盖的空单元格（空洞）
   * 空洞是致命的，因为必须通过消除上方的行才能填满
   * 
   * @param {Array} board - 当前棋盘状态
   * @returns {Number} 空洞总数
   */
  getBuriedHoles: function(board) {
    let holes = 0;
    for (let x = 0; x < 10; x++) {
      let blockFound = false;
      for (let y = 0; y < 20; y++) {
        if (board[y][x]) {
          blockFound = true;  // 找到了上方的方块
        } else if (blockFound) {
          holes++;  // 在方块下方找到空位，这是空洞
        }
      }
    }
    return holes;
  },

  /**
   * 特征6: 井（Wells）
   * 
   * 两侧有块的垂直空列深度
   * 井虽然可以用来消除行，但太深的井会导致难以处理
   * 
   * 计算方法：
   * 对于每个空单元格，检查左右是否有块（边界视为有块）
   * 如果是井，计算井的深度（连续的空单元格数）
   * 
   * @param {Array} board - 当前棋盘状态
   * @returns {Number} 井深度总和
   */
  getWells: function(board) {
    let wellSum = 0;
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 20; y++) {
        if (board[y][x]) continue;  // 只看空单元格
        
        // 检查左右是否有块（边界视为有块）
        const left = (x === 0) ? 1 : board[y][x-1];
        const right = (x === 9) ? 1 : board[y][x+1];
        
        if (left && right) {
          // 找到井的顶部，计算井深度
          let depth = 1;
          for (let k = y + 1; k < 20 && !board[k][x]; k++) {
            // 确保下方也是井结构
            const belowLeft = (x === 0) ? 1 : board[k][x-1];
            const belowRight = (x === 9) ? 1 : board[k][x+1];
            if (belowLeft && belowRight) depth++;
            else break;
          }
          wellSum += depth;
        }
      }
    }
    return wellSum;
  }
};
