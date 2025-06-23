const { InstanceBase, TCPHelper, Regex, runEntrypoint, InstanceStatus } = require('@companion-module/base')

// Base64 compatibility
const atob = (data) => Buffer.from(data, 'base64').toString('ascii')
const btoa = (data) => Buffer.from(data).toString('base64')
const rgb = (r, g, b) => (r << 16) + (g << 8) + b

class MixBoardInstance extends InstanceBase {
	currentChannel = 'CH_0'

	constructor(internal) {
		super(internal)

		this.maxVideoInput = 0;
		this.videoInputList = []
		this.keyerList = []
		this.dataCallback = []
		this.takeMode = []
		this.STATUS = {
			// companion feedbacks
			STOPPED: 0,
			PLAY_TO_PROGRAM: 1,
			PLAY_TO_PREVIEW: 2,
		}

		this.CHANNEL_CHOICES = [
			{ id: 'CH_0', label: 'CH-0' },
			{ id: 'CH_1', label: 'CH-1' },
			{ id: 'CH_2', label: 'CH-2' },
			{ id: 'CH_3', label: 'CH-3' },
		]

		this.TAKEMODE_CHOICES = [
			{ id: 'CUT', label: 'CUT' },
			{ id: 'FADE', label: 'FADE' },
			{ id: 'TR1', label: 'TR1' },
			{ id: 'TR2', label: 'TR2' },
			{ id: 'TR3', label: 'TR3' },
			{ id: 'TR4', label: 'TR4' },
		]

		this.KEYER_CHOICES = [
			{ id: 0, label: 'BKGD' },
			{ id: 1, label: 'KEY1' },
			{ id: 2, label: 'KEY2' },
			{ id: 3, label: 'KEY3' },
			{ id: 4, label: 'KEY4' },
		]

		this.transitionMode = [
			'CUT',
			'FADE',
			'TR1',
			'TR2',
			'TR3',
			'TR4',
		]

		this.keyers = [
			'BKGD',
			'KEY1',
			'KEY2',
			'KEY3',
			'KEY4',
		]
	}

	async init(config) {
		this.config = config

		this.updateStatus(InstanceStatus.Ok)

		this.initActions()
		this.initFeedbacks()

		this.initTCP()
	}

	// When module gets deleted
	async destroy() {
		this.log('debug', 'destroy')

		if (this.socket) {
			this.socket.destroy()
			this.socket = null;
		}

		if (this.eventsocket) {
			this.eventsocket.destroy()
			this.eventsocket = null;
		}
	}

	async configUpdated(config) {
		this.config = config
		await this.init(config)
	}

	initTCP() {
		var ret = false;

		if (this.socket) {
			this.socket.destroy()
			this.socket = null
		}

		// fallback
		if (this.config.port === undefined) this.config.port = 701
		if (this.config.eventport === undefined) this.config.eventport = 801

		if (this.config.host) {
			this.socket = new TCPHelper(this.config.host, this.config.port)
			this.socket.on('status_change', (status) => this.updateStatus(status))
			this.socket.on('error', (err) => this.log('error', 'TCP error: ' + err))

			this.socket.on('connect', () => {
				this.updateStatus('ok')
				setTimeout(this.queryPresets.bind(this), 50)
				setTimeout(this.updateMixBoardInfo.bind(this), 50)
			})

			this.socket.on('data', (data) => {
				if (this.config.protocollog) this.log('debug', 'MixBoard response: ' + data.toString())
				this.tcpDataProcessor(data)
			})
		}

		this.eventsocket = new TCPHelper(this.config.host, this.config.eventport)
		this.eventsocket.on('error', (err) => {
			this.log('error', 'Network error: ' + err.message)
		})

		this.eventsocket.on('data', data => {
			if (this.config.protocollog) this.log('debug', 'MixBoard response: ' + data.toString())
			this.tcpDataProcessor(data)
		})

		return ret;
	}

	/**
	 * Store a VideoInput by ID and return its saved parameters
	 * @param {any} videoInputId id of the VideoInput name
	 */
	getVideoInput(videoInputId) {
		if (videoInputId >= 0) {
			if (this.videoInputList[videoInputId] == null) {
				this.videoInputList[videoInputId] = {
					status: this.STATUS.STOPPED,
					name: 'IN ' + videoInputId
				}
			}
			return this.videoInputList[videoInputId]
		}
		else {
			return {
				status: this.STATUS.STOPPED,
				name: 'IN ' + videoInputId
			}
		}
	}

	/**
	 * Store a Keyer by ID and return its saved parameters
	 * @param {any} keyerId id of the keyer
	 * @returns 
	 */
	getKeyer(keyerId) {
		if (keyerId >= 0) {
			if (this.keyerList[keyerId] == null) this.keyerList[keyerId] = {
				status: this.STATUS.STOPPED,
				linkEnabled: false
			}
			return this.keyerList[keyerId]
		} else return {
			status: this.STATUS.STOPPED,
			linkEnabled: false
		}
	}

	/**
	 * Add keyer presets into the given preset list
	 * 
	 * @param {*} presets the preset list to update
	 */
	addKeyersPresets(presets) {
		// add keyer buttons
		this.keyers.forEach((keyer, index) => {
			const id = keyer.toLowerCase()
			presets[id] = {
				type: 'button',
				category: 'Keyers',
				name: keyer,
				style: {
					text: keyer,
					size: '14',
					color: rgb(255, 255, 255),
					show_topbar: false
				},
				steps: [
					{
						down: [],

						500: [
							{
								actionId: 'keyer_action',
								options: {
									channel: null,
									keyer_id: index,
									play_to_prev: true
								},
							}
						],

						up: [
							{
								actionId: 'keyer_action',
								options: {
									channel: null,
									keyer_id: index,
									play_to_prev: false
								},
							}
						]

					},
				],
				feedbacks: [
					{
						feedbackId: 'program_keyer',
						options: {
							keyer_id: index,
						},
						style: {
							bgcolor: rgb(207, 0, 0),
						},
					},
					{
						feedbackId: 'preview_keyer',
						options: {
							keyer_id: index,
						},
						style: {
							bgcolor: rgb(50, 216, 17),
						},
					},
					{
						feedbackId: 'stopped_keyer',
						options: {
							keyer_id: index,
						},
						style: {
							bgcolor: rgb(0, 0, 0),
						},
					},
				],
			}

			presets[`${keyer.toLowerCase()}_link`] = {
				type: 'button',
				category: 'Keyers',
				name: `${keyer} Link`,
				style: {
					text: `${keyer}`,
					size: '14',
					color: rgb(255, 255, 255),
					png64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAEp2lUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSfvu78nIGlkPSdXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQnPz4KPHg6eG1wbWV0YSB4bWxuczp4PSdhZG9iZTpuczptZXRhLyc+CjxyZGY6UkRGIHhtbG5zOnJkZj0naHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyc+CgogPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9JycKICB4bWxuczpBdHRyaWI9J2h0dHA6Ly9ucy5hdHRyaWJ1dGlvbi5jb20vYWRzLzEuMC8nPgogIDxBdHRyaWI6QWRzPgogICA8cmRmOlNlcT4KICAgIDxyZGY6bGkgcmRmOnBhcnNlVHlwZT0nUmVzb3VyY2UnPgogICAgIDxBdHRyaWI6Q3JlYXRlZD4yMDI1LTA2LTE4PC9BdHRyaWI6Q3JlYXRlZD4KICAgICA8QXR0cmliOkV4dElkPmMyNDA0MDcyLTg0NjEtNDZmMC1hOGE1LWJjZDgwMDJmODA1MDwvQXR0cmliOkV4dElkPgogICAgIDxBdHRyaWI6RmJJZD41MjUyNjU5MTQxNzk1ODA8L0F0dHJpYjpGYklkPgogICAgIDxBdHRyaWI6VG91Y2hUeXBlPjI8L0F0dHJpYjpUb3VjaFR5cGU+CiAgICA8L3JkZjpsaT4KICAgPC9yZGY6U2VxPgogIDwvQXR0cmliOkFkcz4KIDwvcmRmOkRlc2NyaXB0aW9uPgoKIDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PScnCiAgeG1sbnM6ZGM9J2h0dHA6Ly9wdXJsLm9yZy9kYy9lbGVtZW50cy8xLjEvJz4KICA8ZGM6dGl0bGU+CiAgIDxyZGY6QWx0PgogICAgPHJkZjpsaSB4bWw6bGFuZz0neC1kZWZhdWx0Jz5UaXRvbG8gLSAxPC9yZGY6bGk+CiAgIDwvcmRmOkFsdD4KICA8L2RjOnRpdGxlPgogPC9yZGY6RGVzY3JpcHRpb24+CgogPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJv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',
					show_topbar: false
				},
				steps: [
					{
						down: [
							{
								actionId: 'keylink_tap_action',
								options: {
									channel: null,
									keyer_id: index,
								},
							}
						],
						up: []
					},
				],
				feedbacks: [
					{
						feedbackId: 'link_keyer',
						options: {
							keyer_id: index,
						},
						style: {
							bgcolor: rgb(177, 98, 19)
						},
					},
				],
			}
		})
	}

	/**
	 * Add transition presets into the given preset list
	 * 
	 * @param {*} presets the preset list to update
	 */
	addTransitionsPresets(presets) {
		// add transition actions
		this.transitionMode.forEach(takeMode => {
			const id = `take_${takeMode.toLowerCase()}`
			presets[id] = {
				type: 'button',
				category: 'Transitions',
				name: `Take ${takeMode}`,
				style: {
					text: `${takeMode}`,
					size: '14',
					color: rgb(255, 255, 255),
					show_topbar: false
				},
				steps: [
					{
						down: [
							{
								actionId: 'take_action',
								options: {
									channel: null,
									take_mode: takeMode,
								},
							},
						],
						up: [],
					},
				],
			}
		})

		// set take mode presets
		this.TAKEMODE_CHOICES.forEach(choice => {
			let takeMode = choice.id

			// auto take
			presets[`set_takemode_${takeMode}`] = {
				type: 'button',
				category: 'Transitions',
				name: `Set \n${takeMode}`,
				style: {
					text: `set\n${takeMode}`,
					size: '14',
					color: rgb(255, 255, 255),
					show_topbar: false
				},
				steps: [
					{
						down: [
							{
								actionId: 'set_takemode_action',
								options: {
									channel: null,
									take_mode: takeMode,
								},
							},
						],
						up: [],
					},
				],
				feedbacks: [
					{
						feedbackId: 'takemode_changed',
						options: {
							take_mode: takeMode,
						},
						style: {
							bgcolor: rgb(177, 98, 19)
						},
					},
				],
			}
		});

		// auto take
		presets[`auto_take`] = {
			type: 'button',
			category: 'Transitions',
			name: `Auto Take`,
			style: {
				text: 'AUTO\nTAKE',
				size: '14',
				color: rgb(255, 255, 255),
				show_topbar: false
			},
			steps: [
				{
					down: [
						{
							actionId: 'autotake_action',
							options: {
								channel: null,
							},
						},
					],
					up: [],
				},
			],
		}

		// resume back
		presets[`resume_backward`] = {
			type: 'button',
			category: 'Transitions',
			name: `Resume Backward`,
			style: {
				text: `⏮`,
				size: '18',
				color: rgb(255, 255, 255),
				show_topbar: false
			},
			steps: [
				{
					down: [
						{
							actionId: 'resume_action',
							options: {
								channel: null,
								play_direction: 'BACKWARD',
							},
						},
					],
					up: [],
				},
			],
		}

		// resume forward
		presets[`resume_forward`] = {
			type: 'button',
			category: 'Transitions',
			name: `Resume Forward`,
			style: {
				text: `⏭`,
				size: '18',
				color: rgb(255, 255, 255),
				show_topbar: false
			},
			steps: [
				{
					down: [
						{
							actionId: 'resume_action',
							options: {
								channel: null,
								play_direction: 'FORWARD',
							},
						},
					],
					up: [],
				},
			],
		}
	}

	/**
	 * Add channel presets into the given preset list
	 * 
	 * @param {*} presets the preset list to update
	 */
	addChannelsPresets(presets) {
		this.CHANNEL_CHOICES.forEach((item) => {
			let id = item.id;
			let label = item.label
			presets[id] = {
				type: 'button',
				category: 'Channels',
				name: `${label}`,
				style: {
					text: `${label}`,
					size: '14',
					color: rgb(255, 255, 255),
					show_topbar: false
				},
				steps: [
					{
						down: [
							{
								actionId: 'channel_action',
								options: {
									channel: id.toString(),
								},
							},
						],
						up: [],
					},
				],
				feedbacks: [
					{
						feedbackId: 'channel_changed',
						options: {
							channel: id,
						},
						style: {
							bgcolor: rgb(177, 98, 19)
						},
					},
				],
			}
		})
	}

	/**
	 * Query contents from MixBoard and prepare a bank of presets
	 */
	queryPresets() {
		this.sendCommand(`MBC_GETVIDEOINPUTLIST`, (data) => {
			const presets = {}

			if (data.toString().trim() != '') {
				// register keyer presets
				this.addKeyersPresets(presets)

				// transitions presets
				this.addTransitionsPresets(presets)

				// channel presets
				this.addChannelsPresets(presets)

				// parse json
				var jsonData = atob(data.toString().trim())
				const obj = JSON.parse(jsonData);

				this.maxVideoInput = parseInt(obj.MAX_SUPPORTED_INPUTS);

				obj.VIDEOINPUT.forEach((input) => {
					const inputName = input.NAME.toString()
					const inputId = parseInt(input.VIDEOINPUTID)

					// update input name 
					this.getVideoInput(inputId).name = inputName

					const pgmId = `pgm_in_${inputName.toLowerCase()}`
					presets[pgmId] = {
						type: 'button',
						category: 'Program',
						name: `PGM ${inputId}`,
						style: {
							text: inputName,
							size: '14',
							color: rgb(255, 255, 255),
							bgcolor: rgb(0, 0, 0),
							png64: 'data:image/png;base64,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',
							show_topbar: false
						},
						steps: [
							{
								down: [
									{
										actionId: 'set_program_action',
										options: {
											channel: null,
											videoinput_id: inputId,
										},
									},
								],
								up: [],
							},
						],
						feedbacks: [
							{
								feedbackId: 'program_videoinput',
								options: {
									videoinput_id: inputId,
								},
								style: {
									bgcolor: rgb(207, 0, 0),
								},
							},
							{
								feedbackId: 'name_videoinput',
								options: {
									videoinput_id: inputId,
								},
							},
						],
					}

					const prwId = `prw_in_${inputName.toLowerCase()}`
					presets[prwId] = {
						type: 'button',
						category: 'Preview',
						name: `PRW ${inputId}`,
						style: {
							text: inputName,
							size: '14',
							color: rgb(255, 255, 255),
							png64: 'data:image/png;base64,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',
							show_topbar: false
						},
						steps: [
							{
								down: [
									{
										actionId: 'set_preview_action',
										options: {
											channel: null,
											videoinput_id: inputId,
										},
									},
								],
								up: [],
							},
						],
						feedbacks: [
							{
								feedbackId: 'preview_videoinput',
								options: {
									videoinput_id: inputId,
								},
								style: {
									bgcolor: rgb(50, 216, 17),
								},
							},
							{
								feedbackId: 'name_videoinput',
								options: {
									videoinput_id: inputId,
								},
							},
						],
					}
				})

				// refresh input names
				this.checkFeedbacks('name_videoinput')
			}

			this.setPresetDefinitions(presets)
		})
	}

	/**
	 * Util to read parameters from event port
	 * @param {any} query event body
	 * @param {any} variable key to return
	 */
	getQueryVariable(query, variable) {
		var vars = query.split(' ' + variable + '=')
		if (vars.length > 1)
			if (vars[1].startsWith('"')) {
				var t1 = vars[1].split('" ')
				if (t1.length > 1)
					return t1[0].substring(1)
				else
					return vars[1].split('"')[1]
			}
			else return vars[1].split(',')[0]
		return null
	}

	setVideoInputStatus(id, status) {
		let vi = this.getVideoInput(id);
		if (status == this.STATUS.STOPPED)
			vi.status = status
		else
			vi.status |= status;
	}

	disableVideoInputStatus(id, status) {
		let vi = this.getVideoInput(id);
		vi.status &= ~status
	}

	isVideoInputStatus(id, statusToCheck) {
		return (this.getVideoInput(id).status & statusToCheck) == statusToCheck
	}

	/**
	* Process data recived by ClassX LiveBoard instances
	* @param {any} data data recieved
	*/
	tcpDataProcessor(tcpdata) {
		tcpdata
			.toString()
			.split('\n')
			.forEach((data) => {
				if (data.trim() == '') return

				if (data.includes('Welcome to MixBoard')) return
				if (data.trim().startsWith('PING')) return
				if (data.trim().startsWith('Ok')) return

				let dataStr = data.trim();

				if (dataStr.startsWith('PREVIEW_CHANGED')) {
					let channel = this.getQueryVariable(dataStr, 'CHANNEL')

					// it must be the current channel 
					if (channel != this.currentChannel) return

					let videoInputId = parseInt(this.getQueryVariable(dataStr, 'VIDEOINPUTID'))

					// update status
					this.setVideoInputStatus(videoInputId, this.STATUS.PLAY_TO_PREVIEW)

					// update status
					for (let i = 0; i <= this.maxVideoInput; i++) {
						if (i != videoInputId)
							this.disableVideoInputStatus(i, this.STATUS.PLAY_TO_PREVIEW)
					}

					// check feedbacks	
					this.checkFeedbacks('preview_videoinput');
					return
				}
				else if (dataStr.startsWith('PROGRAM_CHANGED')) {
					let channel = this.getQueryVariable(dataStr, 'CHANNEL')

					// it must be the current channel 
					if (channel !== this.currentChannel) return

					let videoInputId = parseInt(this.getQueryVariable(dataStr, 'VIDEOINPUTID'))

					// update status
					this.setVideoInputStatus(videoInputId, this.STATUS.PLAY_TO_PROGRAM)

					// update status
					for (let i = 0; i <= this.maxVideoInput; i++) {
						if (i != videoInputId)
							this.disableVideoInputStatus(i, this.STATUS.PLAY_TO_PROGRAM)
					}

					this.checkFeedbacks('program_videoinput');
					return
				}
				else if (dataStr.startsWith('VIDEOINPUTEVENT')) {
					let videoInputId = parseInt(this.getQueryVariable(dataStr, 'VIDEOINPUTID'))
					let type = this.getQueryVariable(dataStr, 'TYPE')
					let value = this.getQueryVariable(dataStr, 'VALUE')

					// refresh presets
					if (type === 'VIDEOINPUT_CHANGED' || type === 'NAME_CHANGED') {
						this.queryPresets()
					}

					return
				}
				else if (dataStr.startsWith('TRANSITION_STATUS_CHANGED')) {
					let channel = this.getQueryVariable(dataStr, 'CHANNEL')
					let status = this.getQueryVariable(dataStr, 'STATUS').toString().trim()

					// it must be the current channel 
					if (channel !== this.currentChannel) return

					if (status === 'TRANSITION_FINISHED') {
						this.updateMixBoardInfo()
					}

					return
				}
				else if (dataStr.startsWith('KEYER_STATUS_CHANGED')) {
					let channel = this.getQueryVariable(dataStr, 'CHANNEL')
					let keyerId = parseInt(this.getQueryVariable(dataStr, 'KEYERID'))
					let status = this.getQueryVariable(dataStr, 'STATUS').toString().trim()

					// it must be the current channel 
					if (channel !== this.currentChannel) return

					if (status === 'PLAY_TO_PREVIEW') {
						this.getKeyer(keyerId).status = this.STATUS.PLAY_TO_PREVIEW
					}
					else if (status === 'PLAY_TO_PROGRAM') {
						this.getKeyer(keyerId).status = this.STATUS.PLAY_TO_PROGRAM
					}
					else if (status === 'STOP') {
						this.getKeyer(keyerId).status = this.STATUS.STOPPED
					}

					this.checkFeedbacks()
					return
				}
				else if (dataStr.startsWith('KEYER_TRANSITIONLINK_CHANGED')) {
					let channel = this.getQueryVariable(dataStr, 'CHANNEL')
					let keyerId = parseInt(this.getQueryVariable(dataStr, 'KEYERID'))
					let link = this.getQueryVariable(dataStr, 'LINK').toLowerCase() === 'true'

					// it must be the current channel 
					if (channel !== this.currentChannel) return

					this.getKeyer(keyerId).linkEnabled = link

					this.checkFeedbacks('link_keyer')
					return
				}
				else if (dataStr.startsWith('SERVEREVENT')) {
					// unhandled
					return
				}

				if (this.dataCallback.length > 0) {
					this.dataCallback.shift()(dataStr)
					return
				}

				this.log('error', 'Network unhandled recv: ' + data)
			})
	}

	/**
	 * Update MixBoard info 
	 */
	updateMixBoardInfo() {
		this.sendCommand(`MBC_GETMIXBOARDINFO ` + this.currentChannel, (data) => {
			var jsonData = atob(data.toString().trim())
			const jsonObj = JSON.parse(jsonData);

			let previewId = parseInt(jsonObj.PREVIEW.toString());
			let programId = parseInt(jsonObj.PROGRAM.toString());

			// update status
			this.getVideoInput(previewId).status = this.STATUS.PLAY_TO_PREVIEW
			this.getVideoInput(programId).status = this.STATUS.PLAY_TO_PROGRAM

			// update status
			for (let i = 0; i <= this.maxVideoInput; i++) {
				if (i == programId || i == previewId) continue

				// update status
				this.setVideoInputStatus(i, this.STATUS.STOPPED)
			}

			let keyers = jsonObj.KEYER
			keyers.forEach(keyerObj => {
				let kId = keyerObj.KEYERID
				let status = keyerObj.STATUS
				let link = keyerObj.LINK

				let kStatus = this.STATUS.STOPPED
				if (status === "PLAY_TO_PREVIEW")
					kStatus = this.STATUS.PLAY_TO_PREVIEW
				else if (status === "PLAY_TO_PROGRAM")
					kStatus = this.STATUS.PLAY_TO_PROGRAM

				let keyer = this.getKeyer(kId)
				keyer.status = kStatus
				keyer.linkEnabled = link
			})

			this.checkFeedbacks();
		})
	}

	/**
	 * Set instance feedbacks
	 */
	initFeedbacks() {
		this.setFeedbackDefinitions({
			preview_videoinput: {
				type: 'boolean',
				name: 'VideoInput on Preview',
				description: 'The preview VideoInput has changed',
				options: [
					{
						id: 'videoinput_id',
						type: 'number',
						label: 'VideoInput ID',
						default: 0,
						min: 0,
						max: 24
					},
				],
				callback: (feedback) => {
					const id = parseInt(feedback.options.videoinput_id)
					const result = this.isVideoInputStatus(id, this.STATUS.PLAY_TO_PREVIEW)
					return result
				},
			},

			program_videoinput: {
				type: 'boolean',
				name: 'VideoInput on Program',
				description: 'The program VideoInput has changed',
				options: [
					{
						id: 'videoinput_id',
						type: 'number',
						label: 'VideoInput ID',
						default: 0,
					},
				],
				callback: (feedback) => {
					const id = parseInt(feedback.options.videoinput_id)
					const result = this.isVideoInputStatus(id, this.STATUS.PLAY_TO_PROGRAM)
					return result
				},
			},

			name_videoinput: {
				type: 'advanced',
				name: 'VideoInput name changed',
				description: 'The VideoInput name has changed',
				options: [
					{
						id: 'videoinput_id',
						type: 'number',
						label: 'VideoInput ID',
						default: 0,
					},
				],
				callback: (feedback) => {
					return {
						text: this.getVideoInput(feedback.options.videoinput_id).name || `IN ${feedback.options.videoinput_id}`
					};
				},
			},

			stopped_keyer: {
				type: 'boolean',
				name: 'Keyer stopped',
				description: 'The Keyer has stopped',
				options: [
					{
						id: 'keyer_id',
						type: 'number',
						label: 'Keyer ID',
						default: 0,
						min: 0,
						max: 4
					},
				],
				callback: (feedback) => {
					const id = parseInt(feedback.options.keyer_id)
					const result = this.getKeyer(id).status == this.STATUS.STOPPED
					return result
				},
			},

			preview_keyer: {
				type: 'boolean',
				name: 'Keyer on Preview',
				description: 'The Keyer has played to preview',
				options: [
					{
						id: 'keyer_id',
						type: 'number',
						label: 'Keyer ID',
						default: 0,
						min: 0,
						max: 24
					},
				],
				callback: (feedback) => {
					const id = parseInt(feedback.options.keyer_id)
					const result = this.getKeyer(id).status == this.STATUS.PLAY_TO_PREVIEW
					return result
				},
			},

			program_keyer: {
				type: 'boolean',
				name: 'Keyer on Program',
				description: 'The Keyer has played to Program',
				options: [
					{
						id: 'keyer_id',
						type: 'number',
						label: 'Keyer ID',
						default: 0,
					},
				],
				callback: (feedback) => {
					const id = parseInt(feedback.options.keyer_id)
					const result = this.getKeyer(id).status == this.STATUS.PLAY_TO_PROGRAM
					return result
				},
			},

			link_keyer: {
				type: 'boolean',
				name: 'Key link',
				description: 'The Key link status has changed',
				options: [
					{
						id: 'keyer_id',
						type: 'number',
						label: 'Keyer ID',
						default: 0,
					},
				],
				callback: (feedback) => {
					const id = parseInt(feedback.options.keyer_id)
					return this.getKeyer(id).linkEnabled
				},
			},

			channel_changed: {
				type: 'boolean',
				name: 'Current channel',
				description: 'The current channel has changed',
				options: [
					{
						id: 'channel',
						type: 'dropdown',
						label: 'Channel',
						choices: this.CHANNEL_CHOICES,
						default: "CH_0",
					},
				],
				callback: (feedback) => {
					return feedback.options.channel == this.currentChannel
				},
			},

			takemode_changed: {
				type: 'boolean',
				name: 'Take mode changed',
				description: 'The current Take mode has changed',
				options: [
					{
						id: 'take_mode',
						type: 'dropdown',
						label: 'Take Mode',
						choices: this.TAKEMODE_CHOICES,
						default: "CUT",
					},
				],
				callback: (feedback) => {
					 let currentTakeMode = this.takeMode[this.currentChannel] || 'CUT';
					return currentTakeMode == feedback.options.take_mode
				},
			},
		})
	}

	initActions() {
		this.setActionDefinitions({
			channel_action: {
				name: 'Set current channel',
				description: 'Select the current output channel',
				options: [
					{
						type: 'dropdown',
						label: 'Channel',
						id: 'channel',
						choices: this.CHANNEL_CHOICES,
						default: 'CH_0',
					},
				],
				callback: ({ options }) => {
					this.currentChannel = options.channel;
					this.updateMixBoardInfo()
				},
			},

			keyer_action: {
				name: 'Toggle Keyer',
				description: 'Play/Stop the given keyer to program or preview following the "Play to preview" option',
				options: [
					{
						type: 'dropdown',
						label: 'Channel',
						id: 'channel',
						choices: this.CHANNEL_CHOICES,
						default: 'CH_0',
					},
					{
						type: 'dropdown',
						label: 'Keyer',
						id: 'keyer_id',
						choices: this.KEYER_CHOICES,
						default: 1,
					},
					{
						type: 'checkbox',
						label: 'Play to preview',
						id: 'play_to_prev',
						default: false,
					},
				],
				callback: ({ options }) => {
					// channel
					let channel = options.channel ?? this.currentChannel

					// toggle
					if (this.getKeyer(options.keyer_id).status == this.STATUS.STOPPED) {
						// respect the target
						let target = options.play_to_prev ? 'PREVIEW' : 'PROGRAM'
						this.sendCommand(`MBC_PLAYKEYER CHANNEL="${channel}",KEYERID="${options.keyer_id}",TARGET="${target}"`)
					}
					else {
						this.sendCommand(`MBC_STOPKEYER CHANNEL="${channel}",KEYERID="${options.keyer_id}"`)
					}
				},
			},

			keylink_tap_action: {
				name: 'Key link',
				description: 'Enable/disable the keyer transition link option',
				options: [
					{
						type: 'dropdown',
						label: 'Channel',
						id: 'channel',
						choices: this.CHANNEL_CHOICES,
						default: 'CH_0',
					},
					{
						type: 'dropdown',
						label: 'Keyer',
						id: 'keyer_id',
						choices: this.KEYER_CHOICES,
						default: 1,
					},
				],
				callback: ({ options }) => {
					let channel = options.channel ?? this.currentChannel
					let link = !this.getKeyer(options.keyer_id).linkEnabled
					this.sendCommand(`MBC_SETLINKKEYERTOTRANSITION CHANNEL="${channel}",KEYERID="${options.keyer_id}",LINK=${link}`)
					this.sendCommand(`UPDATEGUI`)
				},
			},

			set_takemode_action: {
				name: 'Set take mode',
				description: 'Select the take mode to execute on AUTO take command',
				options: [
					{
						type: 'dropdown',
						label: 'Channel',
						id: 'channel',
						choices: this.CHANNEL_CHOICES,
						default: 'CH_0',
					},
					{
						type: 'dropdown',
						label: 'Take Mode',
						id: 'take_mode',
						choices: this.TAKEMODE_CHOICES,
						default: 'CUT',
					},
				],
				callback: ({ options }) => {
					//this.log('error', 'executing action: ' +  options.take_mode)
					let channel = options.channel ?? this.currentChannel
					this.takeMode[channel] = options.take_mode;
					this.checkFeedbacks('takemode_changed')
				},
			},

			autotake_action: {
				name: 'Auto Take',
				description: 'Auto take transition following the current take mode',
				options: [
					{
						type: 'dropdown',
						label: 'Channel',
						id: 'channel',
						choices: this.CHANNEL_CHOICES,
						default: 'CH_0',
					},
				],
				callback: ({ options }) => {
					let channel = options.channel ?? this.currentChannel
					let takeMode = this.takeMode[channel] ?? 'CUT';
					const cmd = `MBC_TAKE CHANNEL="${channel}",TAKE_MODE="${takeMode}"`
					this.sendCommand(cmd)
				},
			},

			take_action: {
				name: 'Take',
				description: 'Take transition',
				options: [
					{
						type: 'dropdown',
						label: 'Channel',
						id: 'channel',
						choices: this.CHANNEL_CHOICES,
						default: 'CH_0',
					},
					{
						type: 'dropdown',
						label: 'Take Mode',
						id: 'take_mode',
						choices: this.TAKEMODE_CHOICES,
						default: 'CUT',
					},
				],
				callback: ({ options }) => {
					let channel = options.channel ?? this.currentChannel
					const cmd = `MBC_TAKE CHANNEL="${channel}",TAKE_MODE="${options.take_mode}"`
					this.sendCommand(cmd)
				},
			},

			resume_action: {
				name: 'Resume transition',
				description: 'Resume the paused transition following the given direction',
				options: [
					{
						type: 'dropdown',
						label: 'Channel',
						id: 'channel',
						choices: this.CHANNEL_CHOICES,
						default: 'CH_0',
					},
					{
						type: 'textinput',
						label: 'Play direction',
						id: 'play_direction',
						choices: [
							{ id: 'BACKWARD', label: 'Backward' },
							{ id: 'FORWARD', label: 'Forward' },
						],
						default: 'FORWARD',
					},
				],
				callback: ({ options }) => {
					let channel = options.channel ?? this.currentChannel
					const cmd = `MBC_RESUMETRANSITION CHANNEL="${channel}",PLAY_DIRECTION="${options.play_direction}"`
					this.sendCommand(cmd)
				},
			},

			set_preview_action: {
				name: 'Set Preview VideoInput',
				description: 'Set the VideoInput to display to preview',
				options: [
					{
						type: 'dropdown',
						label: 'Channel',
						id: 'channel',
						choices: this.CHANNEL_CHOICES,
						default: 'CH_0',
					},
					{
						type: 'number',
						label: 'VideoInput ID',
						id: 'videoinput_id',
						default: 0,
						min: 0,
						max: 24
					},
				],
				callback: ({ options }) => {
					let channel = options.channel ?? this.currentChannel
					const cmd = `MBC_SETPREVIEWVIDEOINPUTID CHANNEL="${channel}",VIDEOINPUTID="${options.videoinput_id}"`
					this.sendCommand(cmd)
					this.sendCommand(`UPDATEGUI`)
				},
			},

			set_program_action: {
				name: 'Set Program VideoInput',
				description: 'Set the VideoInput to display to program',
				options: [
					{
						type: 'dropdown',
						label: 'Channel',
						id: 'channel',
						choices: this.CHANNEL_CHOICES,
						default: 'CH_0',
					},
					{
						type: 'number',
						label: 'VideoInput ID',
						id: 'videoinput_id',
						default: 0,
						min: 0,
						max: 24
					},
				],
				callback: ({ options }) => {
					let channel = options.channel ?? this.currentChannel
					const cmd = `MBC_SETPROGRAMVIDEOINPUTID CHANNEL="${channel}",VIDEOINPUTID="${options.videoinput_id}"`
					this.sendCommand(cmd)
					this.sendCommand(`UPDATEGUI`)
				},
			},

			command_action: {
				name: 'Execute command',
				description: 'Execute custom MBC command',
				options: [
					{
						id: 'command',
						type: 'textinput',
						label: 'Command'
					},
				],
				callback: ({ options }) => {
					const cmd = `${options.command}`
					this.sendCommand(cmd)
				},
			},
		})
	}

	/**
	 * Send command to ClassX MixBoard instance
	 * @param {any} cmd coomand to execute
	 * @param {any} cb optional, data callback to execute in response to command
	 */
	sendCommand(cmd, cb) {
		if (cmd !== undefined && cmd != '') {
			if (this.socket) {// && this.socket.isConnected()) {
				if (cb) this.dataCallback.push(cb)
				this.socket.send(cmd + '\r\n')
			}
		}
	}

	// Return config fields for web config
	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'important-line',
				width: 12,
				label: 'Information',
				value: 'This module will establish a connection to ClassX MixBoard.',
			},
			{
				type: 'textinput',
				id: 'host',
				label: "MixBoard's IP",
				width: 12,
				regex: this.REGEX_IP,
			},
			{
				type: 'textinput',
				id: 'port',
				label: "MixBoard's command port",
				width: 6,
				regex: this.REGEX_PORT,
			},
			{
				type: 'textinput',
				id: 'eventport',
				label: "MixBoard's event port",
				width: 6,
				regex: this.REGEX_PORT,
			},
			{
				type: 'checkbox',
				id: 'protocollog',
				label: 'Protocol log to console',
				width: 12,
			},
		]
	}
}

runEntrypoint(MixBoardInstance)